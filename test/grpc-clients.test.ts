import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { createGrpcDeviceReadAuthorizer } from "../src/authorization.js";
import { createGrpcDeviceContextResolver } from "../src/device-context.js";

const here = path.dirname(fileURLToPath(import.meta.url));
function loadProto(file: string) {
  const protoPath = path.resolve(here, "..", "proto", file);
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
    includeDirs: [path.dirname(protoPath)],
  });
  return grpc.loadPackageDefinition(packageDefinition) as any;
}

function withFakeTokenEndpoint(
  testFn: (environment: NodeJS.ProcessEnv) => Promise<void>,
) {
  return async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      if (String(input).includes("/protocol/openid-connect/token"))
        return new Response(
          JSON.stringify({ access_token: "fake-token", expires_in: 300 }),
          { status: 200 },
        );
      return originalFetch(input);
    }) as typeof fetch;
    try {
      await testFn({
        SERVICE_CLIENT_SECRET: "test-secret",
        SERVICE_CLIENT_ID: "algaguard-telemetry-service",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  };
}

test(
  "createGrpcDeviceReadAuthorizer calls Decide with telemetry.read and a service token",
  withFakeTokenEndpoint(async (environment) => {
    const proto = loadProto("access_service.proto");
    const received: any[] = [];
    const organizationId = randomUUID();
    const server = new grpc.Server();
    server.addService(proto.algaguard.access.v1.AuthorizationService.service, {
      decide(
        call: grpc.ServerUnaryCall<any, any>,
        callback: grpc.sendUnaryData<any>,
      ) {
        received.push({
          request: call.request,
          authorization: call.metadata.get("authorization")[0],
        });
        callback(null, {
          allowed: true,
          reason: "",
          decidedAt: new Date().toISOString(),
          ttlSeconds: 5,
          resolvedOrganizationId: organizationId,
        });
      },
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(
        "127.0.0.1:0",
        grpc.ServerCredentials.createInsecure(),
        (error, boundPort) => (error ? reject(error) : resolve(boundPort)),
      );
    });
    try {
      const authorize = createGrpcDeviceReadAuthorizer(
        `127.0.0.1:${port}`,
        environment,
      );
      const deviceUuid = randomUUID();
      const decision = await authorize("owner", deviceUuid);
      assert.equal(decision.allowed, true);
      assert.equal(decision.organizationId, organizationId);
      assert.equal(received[0]?.authorization, "Bearer fake-token");
      assert.equal(received[0]?.request.action, "telemetry.read");
      assert.equal(received[0]?.request.resourceType, 2); // device
      assert.equal(received[0]?.request.resourceId, deviceUuid);
    } finally {
      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
    }
  }),
);

test(
  "createGrpcDeviceContextResolver resolves by device id and rejects mismatched identity",
  withFakeTokenEndpoint(async (environment) => {
    const proto = loadProto("device_service.proto");
    const deviceUuid = randomUUID();
    const organizationId = randomUUID();
    const server = new grpc.Server();
    server.addService(proto.algaguard.device.v1.DeviceLookupService.service, {
      getContextByDeviceId(
        call: grpc.ServerUnaryCall<any, any>,
        callback: grpc.sendUnaryData<any>,
      ) {
        callback(null, {
          deviceUuid,
          deviceId: call.request.deviceId,
          organizationId,
          status: 5, // ACTIVE
          ownershipVersion: "1",
          resolvedAt: new Date().toISOString(),
          tankId: "",
          contextVersion: "1",
        });
      },
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(
        "127.0.0.1:0",
        grpc.ServerCredentials.createInsecure(),
        (error, boundPort) => (error ? reject(error) : resolve(boundPort)),
      );
    });
    try {
      const resolve = createGrpcDeviceContextResolver(
        `127.0.0.1:${port}`,
        environment,
      );
      const context = await resolve("AG-000001");
      assert.equal(context.deviceUuid, deviceUuid);
      assert.equal(context.organizationId, organizationId);
    } finally {
      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
    }
  }),
);
