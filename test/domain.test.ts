import assert from "node:assert/strict";
import test from "node:test";
import { TelemetryService, page, type BatchOutcome } from "../src/domain.js";
const batch = {
  batchId: "10000000-0000-4000-8000-000000000001",
  deviceId: "AG-000001",
  samples: [{ sequence: "1", values: { ph: 7 }, qualityFlags: ["SIMULATED"] }],
};
test("durable commit precedes Redis publication", async () => {
  const order: string[] = [];
  const outcome: BatchOutcome = {
    batchId: batch.batchId,
    deviceId: batch.deviceId,
    status: "ACCEPTED",
    acceptedThroughSequence: "1",
    duplicate: false,
    storedSamples: 1,
    receivedAt: new Date().toISOString(),
  };
  const service = new TelemetryService(
    async () => {
      order.push("commit");
      return outcome;
    },
    async () => {
      order.push("publish");
    },
  );
  assert.equal((await service.accept(batch)).status, "ACCEPTED");
  assert.deepEqual(order, ["commit", "publish"]);
});
test("database failure never publishes or returns accepted", async () => {
  let published = false;
  const service = new TelemetryService(
    async () => {
      throw new Error("database unavailable");
    },
    async () => {
      published = true;
    },
  );
  await assert.rejects(service.accept(batch));
  assert.equal(published, false);
});
test("duplicate outcome does not emit a second Redis event", async () => {
  let published = false;
  const service = new TelemetryService(
    async () => ({
      batchId: batch.batchId,
      deviceId: batch.deviceId,
      status: "DUPLICATE",
      acceptedThroughSequence: "1",
      duplicate: true,
      storedSamples: 0,
      receivedAt: new Date().toISOString(),
    }),
    async () => {
      published = true;
    },
  );
  assert.equal((await service.accept(batch)).status, "DUPLICATE");
  assert.equal(published, false);
});
test("pagination is bounded", () => {
  assert.equal(page([1, 2, 3], 0, 2).nextCursor, 2);
});
