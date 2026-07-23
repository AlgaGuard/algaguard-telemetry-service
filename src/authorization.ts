export interface DeviceReadDecision {
  allowed: boolean;
  organizationId?: string | undefined;
}
export type DeviceReadAuthorizer = (
  subjectId: string,
  deviceUuid: string,
) => Promise<DeviceReadDecision>;

let cachedToken: { value: string; expiresAt: number } | undefined;

export async function serviceToken(environment: NodeJS.ProcessEnv) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000)
    return cachedToken.value;
  const issuer =
    environment.KEYCLOAK_ISSUER ?? "http://keycloak:8080/realms/algaguard";
  const secret = environment.SERVICE_CLIENT_SECRET;
  if (!secret) throw new Error("SERVICE_CLIENT_SECRET is required");
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: environment.SERVICE_CLIENT_ID ?? "algaguard-telemetry-service",
      client_secret: secret,
    }),
  });
  if (!response.ok) throw new Error("Telemetry service authentication failed");
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("Service token response invalid");
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 30) * 1000,
  };
  return cachedToken.value;
}

export function createDeviceReadAuthorizer(
  environment: NodeJS.ProcessEnv = process.env,
): DeviceReadAuthorizer {
  const accessUrl =
    environment.ACCESS_SERVICE_URL ?? "http://access-service:3000";
  return async (subjectId, deviceUuid) => {
    const response = await fetch(
      `${accessUrl}/v1/internal/authorizations/decide`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await serviceToken(environment)}`,
        },
        body: JSON.stringify({
          subjectId,
          action: "telemetry.read",
          resourceType: "device",
          resourceId: deviceUuid,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`Access authorization failed with ${response.status}`);
    const decision = (await response.json()) as {
      allowed?: boolean;
      organizationId?: string;
    };
    return {
      allowed: decision.allowed === true,
      ...(decision.organizationId
        ? { organizationId: decision.organizationId }
        : {}),
    };
  };
}
