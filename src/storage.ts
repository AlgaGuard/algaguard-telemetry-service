import pg from "pg";
import { createClient, type RedisClientType } from "redis";
import type { BatchOutcome, TelemetryBatch } from "./domain.js";
export class TelemetryRepository {
  readonly pool: pg.Pool;
  private readonly redis: RedisClientType;
  constructor(
    databaseUrl = process.env.DATABASE_URL,
    redisUrl = process.env.REDIS_URL,
  ) {
    if (!databaseUrl || !redisUrl)
      throw new Error("DATABASE_URL and REDIS_URL are required");
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    this.redis = createClient({ url: redisUrl });
    this.redis.on("error", (error) =>
      process.stderr.write(
        `${JSON.stringify({ level: "error", component: "redis", message: error.message })}\n`,
      ),
    );
  }
  async persist(batch: TelemetryBatch): Promise<BatchOutcome> {
    const client = await this.pool.connect();
    const receivedAt = new Date();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `INSERT INTO telemetry_batches(
           batch_id,device_id,device_uuid,organization_id_at_ingest,
           ownership_version_at_ingest,first_sequence,last_sequence,sample_count,
           status,accepted_through_sequence,duplicate,stored_samples,received_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PROCESSING',NULL,false,0,$9)
         ON CONFLICT(batch_id) DO NOTHING RETURNING batch_id`,
        [
          batch.batchId,
          batch.deviceId,
          batch.deviceUuid,
          batch.organizationId,
          batch.ownershipVersion,
          batch.samples[0]!.sequence,
          batch.samples.at(-1)!.sequence,
          batch.samples.length,
          receivedAt,
        ],
      );
      if (!claimed.rowCount) {
        const prior = await client.query(
          "SELECT * FROM telemetry_batches WHERE batch_id=$1",
          [batch.batchId],
        );
        await client.query("COMMIT");
        const row = prior.rows[0];
        return {
          batchId: batch.batchId,
          deviceId: String(row.device_id),
          status: "DUPLICATE",
          acceptedThroughSequence:
            row.accepted_through_sequence === null
              ? null
              : String(row.accepted_through_sequence),
          duplicate: true,
          storedSamples: 0,
          receivedAt: new Date(row.received_at).toISOString(),
        };
      }
      const rejected: string[] = [];
      let storedSamples = 0;
      for (const sample of batch.samples) {
        const key = await client.query(
          `INSERT INTO telemetry_sequence_keys(
             device_id,sequence,batch_id,device_uuid,organization_id_at_ingest,
             ownership_version_at_ingest)
           VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(device_id,sequence) DO NOTHING RETURNING sequence`,
          [
            batch.deviceId,
            sample.sequence,
            batch.batchId,
            batch.deviceUuid,
            batch.organizationId,
            batch.ownershipVersion,
          ],
        );
        if (!key.rowCount) {
          rejected.push(sample.sequence);
          continue;
        }
        await client.query(
          `INSERT INTO telemetry_samples(
             device_id,sequence,observed_at,values,quality_flags,batch_id,
             device_uuid,organization_id_at_ingest,ownership_version_at_ingest,
             timestamp_quality,uptime_ms,simulation_scenario,extensions)
           VALUES($1,$2,$3,$4::jsonb,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [
            batch.deviceId,
            sample.sequence,
            sample.observedAt ?? receivedAt,
            JSON.stringify(sample.values),
            sample.qualityFlags ?? [],
            batch.batchId,
            batch.deviceUuid,
            batch.organizationId,
            batch.ownershipVersion,
            sample.timestampQuality,
            sample.uptimeMs,
            sample.simulationScenario ?? null,
            JSON.stringify(sample.extensions ?? {}),
          ],
        );
        storedSamples += 1;
      }
      const status =
        storedSamples === 0
          ? "DUPLICATE"
          : rejected.length
            ? "PARTIALLY_ACCEPTED"
            : "ACCEPTED";
      const acceptedThroughSequence = batch.samples.at(-1)?.sequence ?? null;
      await client.query(
        `UPDATE telemetry_batches SET status=$2,accepted_through_sequence=$3,duplicate=$4,stored_samples=$5,rejected_sequences=$6::text[]
          WHERE batch_id=$1`,
        [
          batch.batchId,
          status,
          acceptedThroughSequence,
          status === "DUPLICATE",
          storedSamples,
          rejected,
        ],
      );
      await client.query("COMMIT");
      return {
        batchId: batch.batchId,
        deviceId: batch.deviceId,
        status,
        acceptedThroughSequence,
        duplicate: status === "DUPLICATE",
        storedSamples,
        ...(rejected.length
          ? {
              rejectedSequences: rejected,
              errors: rejected.map(() => ({
                code: "DUPLICATE_SEQUENCE",
                message: "Sequence already committed",
                retryable: false,
              })),
            }
          : {}),
        receivedAt: receivedAt.toISOString(),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async publish(event: Record<string, unknown>) {
    if (!this.redis.isOpen) await this.redis.connect();
    await this.redis.publish("algaguard.live", JSON.stringify(event));
  }
  async history(deviceUuid: string, limit: number) {
    const result = await this.pool.query(
      `SELECT device_id AS "deviceId",organization_id_at_ingest AS "organizationIdAtIngest",
              ownership_version_at_ingest::text AS "ownershipVersionAtIngest",
              sequence::text,observed_at AS "observedAt",timestamp_quality AS "timestampQuality",
              uptime_ms::text AS "uptimeMs",values,quality_flags AS "qualityFlags",batch_id AS "batchId"
         FROM telemetry_samples WHERE device_uuid=$1 ORDER BY observed_at DESC LIMIT $2`,
      [deviceUuid, Math.min(Math.max(limit, 1), 200)],
    );
    return result.rows as Array<Record<string, unknown>>;
  }
  async aggregate(deviceUuid: string) {
    const result = await this.pool.query(
      `SELECT count(*)::integer AS "sampleCount",min(observed_at) AS "from",max(observed_at) AS "through" FROM telemetry_samples WHERE device_uuid=$1`,
      [deviceUuid],
    );
    return result.rows[0] as Record<string, unknown>;
  }
  async health() {
    await this.pool.query("SELECT 1");
  }
  async close() {
    if (this.redis.isOpen) await this.redis.quit();
    await this.pool.end();
  }
}
