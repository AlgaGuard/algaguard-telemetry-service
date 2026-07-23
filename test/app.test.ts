import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { HttpError, type Authenticator } from "../src/auth.js";
import { buildApp } from "../src/app.js";
import { createRouter, type RouteDependencies } from "../src/routes.js";
test("liveness and correlation middleware are available", async () => {
  const response = await request(buildApp())
    .get("/health/live")
    .set("x-correlation-id", "test-correlation");
  assert.equal(response.status, 200);
  assert.equal(response.body.service, "algaguard-telemetry-service");
  assert.equal(response.headers["x-correlation-id"], "test-correlation");
});
test("unknown routes use problem details", async () => {
  const response = await request(buildApp()).get("/missing");
  assert.equal(response.status, 404);
  assert.match(
    response.headers["content-type"] ?? "",
    /application\/problem\+json/,
  );
});

const authenticate: Authenticator = async (authorization) => {
  if (authorization === "Bearer mqtt")
    return {
      subjectId: "mqtt-service",
      clientId: "algaguard-mqtt-ingestion-service",
      service: true,
    };
  if (authorization === "Bearer user")
    return { subjectId: "user-1", service: false };
  throw new HttpError(401, "invalid token");
};

function authorizedApp(overrides: Partial<RouteDependencies> = {}) {
  const dependencies: RouteDependencies = {
    authenticate,
    authorizeDeviceRead: async () => true,
    accept: async (batch) => ({
      batchId: batch.batchId,
      deviceId: batch.deviceId,
      status: "ACCEPTED",
      acceptedThroughSequence: batch.samples.at(-1)?.sequence ?? null,
      duplicate: false,
      storedSamples: batch.samples.length,
      receivedAt: "2026-07-23T00:00:00Z",
    }),
    history: async () => [],
    aggregate: async () => ({ sampleCount: 0 }),
    ...overrides,
  };
  return buildApp({
    apiRouter: createRouter(dependencies),
    health: async () => {},
  });
}

test("only the authenticated MQTT ingestion client can commit batches", async () => {
  let accepted = false;
  const body = {
    batchId: "10000000-0000-4000-8000-000000000001",
    deviceId: "AG-000001",
    samples: [{ sequence: "1", values: { ph: 7 } }],
  };
  const app = authorizedApp({
    accept: async (batch) => {
      accepted = true;
      return {
        batchId: batch.batchId,
        deviceId: batch.deviceId,
        status: "ACCEPTED",
        acceptedThroughSequence: "1",
        duplicate: false,
        storedSamples: 1,
        receivedAt: "2026-07-23T00:00:00Z",
      };
    },
  });
  assert.equal(
    (
      await request(app)
        .post("/v1/ingestion/batches")
        .set("authorization", "Bearer user")
        .send(body)
    ).status,
    403,
  );
  assert.equal(accepted, false);
  assert.equal(
    (
      await request(app)
        .post("/v1/ingestion/batches")
        .set("authorization", "Bearer mqtt")
        .send(body)
    ).status,
    202,
  );
  assert.equal(accepted, true);
});

test("telemetry reads require an Access Service decision", async () => {
  const denied = authorizedApp({ authorizeDeviceRead: async () => false });
  assert.equal(
    (
      await request(denied)
        .get("/v1/devices/AG-000001/latest")
        .set("authorization", "Bearer user")
    ).status,
    403,
  );
  const allowed = authorizedApp({ authorizeDeviceRead: async () => true });
  assert.equal(
    (
      await request(allowed)
        .get("/v1/devices/AG-000001/latest")
        .set("authorization", "Bearer user")
    ).status,
    200,
  );
});

test("contract maximum of 120 samples is accepted", async () => {
  const samples = Array.from({ length: 120 }, (_, index) => ({
    sequence: String(index + 1),
    values: { ph: 7 },
  }));
  const response = await request(authorizedApp())
    .post("/v1/ingestion/batches")
    .set("authorization", "Bearer mqtt")
    .send({
      batchId: "10000000-0000-4000-8000-000000000001",
      deviceId: "AG-000001",
      samples,
    });
  assert.equal(response.status, 202);
  assert.equal(response.body.storedSamples, 120);
});
