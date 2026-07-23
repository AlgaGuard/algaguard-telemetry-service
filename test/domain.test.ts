import assert from "node:assert/strict";
import test from "node:test";
import {
  StaleDeviceContextError,
  TelemetryService,
  page,
  type BatchOutcome,
} from "../src/domain.js";
import { acceptedOutcome, batch, context } from "./fixtures.js";

const resolve = async () => context;

test("durable commit precedes contract-shaped telemetry.committed publication", async () => {
  const order: string[] = [];
  let published: Record<string, unknown> | undefined;
  const service = new TelemetryService(
    async () => {
      order.push("commit");
      return acceptedOutcome;
    },
    async (event) => {
      order.push("publish");
      published = event;
    },
    resolve,
    () => new Date("2026-07-23T00:00:02Z"),
  );
  assert.equal((await service.accept(batch)).status, "ACCEPTED");
  assert.deepEqual(order, ["commit", "publish"]);
  assert.equal(
    published?.schema,
    "urn:algaguard:schema:internal:telemetry-committed:v1",
  );
  assert.equal(published?.schemaVersion, "1.0.0");
  assert.equal(published?.eventType, "telemetry.committed");
  assert.match(String(published?.eventId), /^[0-9a-f-]{36}$/);
  assert.equal(published?.occurredAt, "2026-07-23T00:00:02.000Z");
  assert.equal(published?.deviceUuid, batch.deviceUuid);
  assert.equal(published?.deviceId, batch.deviceId);
  assert.equal(published?.organizationId, batch.organizationId);
  assert.equal(published?.ownershipVersion, "1");
  assert.equal(published?.firstSequence, "1");
  assert.equal(published?.lastSequence, "1");
  assert.equal(published?.sampleCount, 1);
  assert.deepEqual(published?.payload, {
    sample: batch.samples[0],
    activeProfile: batch.activeProfile,
  });
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
    resolve,
  );
  await assert.rejects(service.accept(batch));
  assert.equal(published, false);
});

test("duplicate outcome does not emit a second Redis event", async () => {
  let published = false;
  const service = new TelemetryService(
    async () => ({
      ...acceptedOutcome,
      status: "DUPLICATE",
      duplicate: true,
      storedSamples: 0,
    }),
    async () => {
      published = true;
    },
    resolve,
  );
  assert.equal((await service.accept(batch)).status, "DUPLICATE");
  assert.equal(published, false);
});

test("stale ownership or identity context is rejected before persistence", async () => {
  let persisted = false;
  const variants = [
    { organizationId: "60000000-0000-4000-8000-000000000002" },
    { ownershipVersion: "2" },
    { deviceUuid: "20000000-0000-4000-8000-000000000002" },
  ];
  for (const variant of variants) {
    const service = new TelemetryService(
      async () => {
        persisted = true;
        return acceptedOutcome;
      },
      async () => {},
      async () => ({ ...context, ...variant }),
    );
    await assert.rejects(service.accept(batch), StaleDeviceContextError);
  }
  assert.equal(persisted, false);
});

test("partially accepted publication contains only newly committed samples", async () => {
  const twoSamples = {
    ...batch,
    samples: [
      batch.samples[0]!,
      { ...batch.samples[0]!, sequence: "2", uptimeMs: "2000" },
    ],
  };
  let published: Record<string, unknown> | undefined;
  const outcome: BatchOutcome = {
    ...acceptedOutcome,
    status: "PARTIALLY_ACCEPTED",
    storedSamples: 1,
    acceptedThroughSequence: "2",
    rejectedSequences: ["1"],
  };
  await new TelemetryService(
    async () => outcome,
    async (event) => {
      published = event;
    },
    resolve,
  ).accept(twoSamples);
  assert.equal(published?.firstSequence, "2");
  assert.equal(published?.lastSequence, "2");
  assert.equal(published?.sampleCount, 1);
});

test("pagination is bounded", () => {
  assert.equal(page([1, 2, 3], 0, 2).nextCursor, 2);
});
