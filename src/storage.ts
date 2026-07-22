import pg from "pg";
import { createClient, type RedisClientType } from "redis";
import type { TelemetryBatch } from "./domain.js";

const schema = `
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS telemetry_samples (
  device_id text NOT NULL,
  sequence numeric(20,0) NOT NULL,
  observed_at timestamptz NOT NULL,
  values jsonb NOT NULL,
  quality_flags text[] NOT NULL DEFAULT '{}',
  batch_id uuid NOT NULL,
  PRIMARY KEY(device_id, sequence, observed_at)
);
SELECT create_hypertable('telemetry_samples', by_range('observed_at'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS telemetry_device_time ON telemetry_samples(device_id, observed_at DESC);
`;

export class TelemetryRepository {
  private readonly pool: pg.Pool;
  private readonly redis: RedisClientType;
  private initialization?: Promise<void>;

  constructor(
    databaseUrl = process.env.DATABASE_URL,
    redisUrl = process.env.REDIS_URL,
  ) {
    if (!databaseUrl || !redisUrl) {
      throw new Error("DATABASE_URL and REDIS_URL are required");
    }
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    this.redis = createClient({ url: redisUrl });
    this.redis.on("error", (error) =>
      process.stderr.write(
        `${JSON.stringify({ level: "error", component: "redis", message: error.message })}\n`,
      ),
    );
  }

  private async initialize() {
    this.initialization ??= this.pool.query(schema).then(() => undefined);
    await this.initialization;
  }

  async persist(batch: TelemetryBatch) {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const sample of batch.samples) {
        await client.query(
          `INSERT INTO telemetry_samples
             (device_id, sequence, observed_at, values, quality_flags, batch_id)
           VALUES ($1, $2, $3, $4::jsonb, $5::text[], $6)
           ON CONFLICT DO NOTHING`,
          [
            batch.deviceId,
            sample.sequence,
            sample.observedAt ?? new Date().toISOString(),
            JSON.stringify(sample.values),
            sample.qualityFlags ?? [],
            batch.batchId,
          ],
        );
      }
      await client.query("COMMIT");
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

  async history(deviceId: string, limit: number) {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT sequence::text, observed_at AS "observedAt", values,
              quality_flags AS "qualityFlags", batch_id AS "batchId"
         FROM telemetry_samples
        WHERE device_id = $1
        ORDER BY observed_at DESC
        LIMIT $2`,
      [deviceId, Math.min(Math.max(limit, 1), 200)],
    );
    return result.rows as Array<Record<string, unknown>>;
  }

  async aggregate(deviceId: string) {
    await this.initialize();
    const result = await this.pool.query(
      `SELECT count(*)::integer AS "sampleCount",
              min(observed_at) AS "from", max(observed_at) AS "through"
         FROM telemetry_samples WHERE device_id = $1`,
      [deviceId],
    );
    return result.rows[0] as Record<string, unknown>;
  }
}
