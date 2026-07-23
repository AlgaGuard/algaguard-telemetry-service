import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { TelemetryRepository } from "../src/storage.js";
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
test(
  "sequence and batch idempotency survive repository restart",
  { skip: !databaseUrl },
  async () => {
    const cleanup = new pg.Pool({ connectionString: databaseUrl });
    await cleanup.query(
      "TRUNCATE telemetry_batches,telemetry_sequence_keys,telemetry_samples",
    );
    await cleanup.end();
    const batch = {
      batchId: "10000000-0000-4000-8000-000000000001",
      deviceId: "AG-000001",
      samples: [
        {
          sequence: "1",
          observedAt: "2026-07-23T00:00:00Z",
          values: { ph: 7 },
        },
        {
          sequence: "2",
          observedAt: "2026-07-23T00:00:01Z",
          values: { ph: 7.1 },
        },
      ],
    };
    const first = new TelemetryRepository(
      databaseUrl,
      "redis://127.0.0.1:6399",
    );
    assert.equal((await first.persist(batch)).status, "ACCEPTED");
    await first.close();
    const restarted = new TelemetryRepository(
      databaseUrl,
      "redis://127.0.0.1:6399",
    );
    const duplicate = await restarted.persist(batch);
    assert.equal(duplicate.status, "DUPLICATE");
    assert.equal(duplicate.duplicate, true);
    const rows = await restarted.pool.query(
      "SELECT count(*)::integer AS count FROM telemetry_samples",
    );
    assert.equal(rows.rows[0].count, 2);
    const replayWithNewBatch = await restarted.persist({
      ...batch,
      batchId: "10000000-0000-4000-8000-000000000002",
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
    await restarted.close();
  },
);
