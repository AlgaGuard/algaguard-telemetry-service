import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceReadAuthorizer } from "../src/authorization.js";
import { batch } from "./fixtures.js";

test("Access decisions return trusted organization context for history filtering", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/protocol/openid-connect/token")) {
      return new Response(
        JSON.stringify({ access_token: "telemetry-token", expires_in: 60 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        allowed: true,
        organizationId: batch.organizationId,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const authorize = createDeviceReadAuthorizer({
      SERVICE_CLIENT_SECRET: "test-only-secret",
      ACCESS_SERVICE_URL: "http://access.test",
      KEYCLOAK_ISSUER: "http://keycloak.test/realms/algaguard",
    });
    assert.deepEqual(await authorize("user-a", batch.deviceUuid), {
      allowed: true,
      organizationId: batch.organizationId,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
