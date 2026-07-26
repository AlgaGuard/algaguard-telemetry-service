import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceContextResolver } from "../src/device-context.js";
import { context } from "./fixtures.js";

test("Telemetry resolves Device Service context with its client-credentials token", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | undefined }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      authorization: (init?.headers as Record<string, string> | undefined)
        ?.authorization,
    });
    if (
      url ===
      "http://keycloak:8080/realms/algaguard/protocol/openid-connect/token"
    ) {
      return new Response(
        JSON.stringify({ access_token: "telemetry-token", expires_in: 60 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(context), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const resolve = createDeviceContextResolver({
      SERVICE_CLIENT_SECRET: "test-only-secret",
      DEVICE_SERVICE_URL: "http://device-service.test",
      KEYCLOAK_ISSUER: "https://dev.algaguard.example/auth/realms/algaguard",
      KEYCLOAK_TOKEN_URL:
        "http://keycloak:8080/realms/algaguard/protocol/openid-connect/token",
    });
    assert.deepEqual(await resolve(context.deviceId), context);
    assert.equal(
      calls[0]!.url,
      "http://keycloak:8080/realms/algaguard/protocol/openid-connect/token",
    );
    assert.match(calls[1]!.url, /by-device-id\/AG-000001\/context$/);
    assert.equal(calls[1]!.authorization, "Bearer telemetry-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
