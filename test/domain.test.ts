import test from "node:test";
import assert from "node:assert/strict";
import { TelemetryService, page } from "../src/domain.js";
test("durable store precedes Redis live publication and duplicate is idempotent", async () => {
  const order: string[] = [];
  const service = new TelemetryService(
    async () => {
      order.push("commit");
    },
    async () => {
      order.push("publish");
    },
  );
  const batch = {
    batchId: "batch",
    deviceId: "device",
    samples: [
      { sequence: "1", values: { ph: 7 }, qualityFlags: ["SIMULATED"] },
    ],
  };
  assert.equal((await service.accept(batch)).status, "ACCEPTED");
  assert.deepEqual(order, ["commit", "publish"]);
  assert.equal((await service.accept(batch)).status, "DUPLICATE");
});
test("pagination is bounded", () => {
  assert.equal(page([1, 2, 3], 0, 2).nextCursor, 2);
});
