import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { TelemetryRepository } from "../src/storage.js";
import { batch } from "./fixtures.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test(
  "identity, organization-at-ingest, and idempotency survive restart and transfer",
  { skip: !databaseUrl },
  async () => {
    const cleanup = new pg.Pool({ connectionString: databaseUrl });
    await cleanup.query(
      "TRUNCATE telemetry_batches,telemetry_sequence_keys,telemetry_samples",
    );
    await cleanup.end();

    const first = new TelemetryRepository(
      databaseUrl,
      "redis://127.0.0.1:6399",
    );
    assert.equal((await first.persist(batch)).status, "ACCEPTED");
    const stored = await first.pool.query(
      `SELECT device_uuid::text,device_id,organization_id_at_ingest::text,
              ownership_version_at_ingest::text,timestamp_quality,uptime_ms::text
         FROM telemetry_samples WHERE batch_id=$1`,
      [batch.batchId],
    );
    assert.deepEqual(stored.rows[0], {
      device_uuid: batch.deviceUuid,
      device_id: batch.deviceId,
      organization_id_at_ingest: batch.organizationId,
      ownership_version_at_ingest: "1",
      timestamp_quality: "NTP_SYNCED",
      uptime_ms: "1000",
    });
    await first.close();

    const restarted = new TelemetryRepository(
      databaseUrl,
      "redis://127.0.0.1:6399",
    );
    const duplicate = await restarted.persist(batch);
    assert.equal(duplicate.status, "DUPLICATE");
    assert.equal(duplicate.duplicate, true);

    const transferred = {
      ...batch,
      batchId: "10000000-0000-4000-8000-000000000002",
      organizationId: "60000000-0000-4000-8000-000000000002",
      ownershipVersion: "2",
      samples: [
        {
          ...batch.samples[0]!,
          sequence: "2",
          observedAt: "2026-07-23T00:01:00Z",
          uptimeMs: "2000",
        },
      ],
    };
    assert.equal((await restarted.persist(transferred)).status, "ACCEPTED");
    const history = await restarted.pool.query(
      `SELECT sequence::text,organization_id_at_ingest::text,
              ownership_version_at_ingest::text
         FROM telemetry_samples ORDER BY sequence`,
    );
    assert.deepEqual(history.rows, [
      {
        sequence: "1",
        organization_id_at_ingest: batch.organizationId,
        ownership_version_at_ingest: "1",
      },
      {
        sequence: "2",
        organization_id_at_ingest: transferred.organizationId,
        ownership_version_at_ingest: "2",
      },
    ]);
    assert.equal(
      (await restarted.history(batch.deviceUuid, batch.organizationId, 10))
        .length,
      1,
    );
    assert.equal(
      (
        await restarted.history(
          batch.deviceUuid,
          transferred.organizationId,
          10,
        )
      ).length,
      1,
    );
    assert.equal(
      (await restarted.aggregate(batch.deviceUuid, transferred.organizationId))
        .sampleCount,
      1,
    );

    const replayWithNewBatch = await restarted.persist({
      ...transferred,
      batchId: "10000000-0000-4000-8000-000000000003",
    });
    assert.equal(replayWithNewBatch.status, "DUPLICATE");
    assert.equal(
      (
        await restarted.pool.query(
          "SELECT count(*)::integer AS count FROM telemetry_samples",
        )
      ).rows[0].count,
      2,
    );

    await restarted.pool.query(
      `INSERT INTO telemetry_batches(
         batch_id,device_id,status,accepted_through_sequence,duplicate,
         stored_samples,rejected_sequences,received_at)
       VALUES($1,'AG-000099','ACCEPTED',1,false,1,'{}',now())`,
      ["10000000-0000-4000-8000-000000000099"],
    );
    const legacy = await restarted.pool.query(
      "SELECT device_uuid FROM telemetry_batches WHERE batch_id=$1",
      ["10000000-0000-4000-8000-000000000099"],
    );
    assert.equal(legacy.rows[0].device_uuid, null);
    await restarted.close();
  },
);
