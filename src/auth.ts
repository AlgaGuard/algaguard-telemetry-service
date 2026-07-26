import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface Principal {
  subjectId: string;
  clientId?: string;
  service: boolean;
}

export type Authenticator = (
  authorization: string | undefined,
) => Promise<Principal>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function principal(
  payload: JWTPayload,
  serviceClients: Set<string>,
): Principal {
  if (!payload.sub) throw new HttpError(401, "Token subject is required");
  const clientId =
    typeof payload.azp === "string"
      ? payload.azp
      : typeof payload.client_id === "string"
        ? payload.client_id
        : undefined;
  return {
    subjectId: payload.sub,
    ...(clientId ? { clientId } : {}),
    service: Boolean(clientId && serviceClients.has(clientId)),
  };
}

export function createAuthenticator(
  environment: NodeJS.ProcessEnv = process.env,
): Authenticator {
  const issuer =
    environment.KEYCLOAK_ISSUER ?? "http://keycloak:8080/realms/algaguard";
  const audience = environment.KEYCLOAK_AUDIENCE ?? "algaguard-api";
  const serviceClients = new Set(
    (environment.SERVICE_CLIENT_IDS ?? "algaguard-mqtt-ingestion-service")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const jwksUrl =
    environment.KEYCLOAK_JWKS_URL ?? `${issuer}/protocol/openid-connect/certs`;
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (authorization) => {
    const match = /^Bearer ([^ ]+)$/.exec(authorization ?? "");
    if (!match?.[1]) throw new HttpError(401, "Bearer token required");
    try {
      const verified = await jwtVerify(match[1], jwks, { issuer, audience });
      return principal(verified.payload, serviceClients);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, "Bearer token is invalid");
    }
  };
}
