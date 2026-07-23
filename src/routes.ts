import { Router, type Request } from "express";
import { z } from "zod";
import { createAuthenticator, HttpError, type Authenticator } from "./auth.js";
import {
  createDeviceReadAuthorizer,
  type DeviceReadAuthorizer,
} from "./authorization.js";
import {
  TelemetryService,
  type BatchOutcome,
  type TelemetryBatch,
} from "./domain.js";
import { TelemetryRepository } from "./storage.js";

let repository: TelemetryRepository | undefined;
export const storage = () => (repository ??= new TelemetryRepository());
const defaultService = new TelemetryService(
  async (batch) => storage().persist(batch),
  async (event) => storage().publish(event),
);

export interface RouteDependencies {
  authenticate: Authenticator;
  authorizeDeviceRead: DeviceReadAuthorizer;
  accept(batch: TelemetryBatch): Promise<BatchOutcome>;
  history(
    deviceId: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>>;
  aggregate(deviceId: string): Promise<Record<string, unknown>>;
}

const batchSchema = z.object({
  batchId: z.string().uuid(),
  deviceId: z.string().regex(/^AG-[0-9]{6}$/),
  samples: z
    .array(
      z.object({
        sequence: z.string().regex(/^(0|[1-9][0-9]{0,19})$/),
        observedAt: z.string().datetime().optional(),
        values: z.record(z.string(), z.number()),
        qualityFlags: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(120),
});

async function actor(request: Request, authenticate: Authenticator) {
  return authenticate(request.header("authorization"));
}

export function createRouter(
  dependencies: RouteDependencies = {
    authenticate: createAuthenticator(),
    authorizeDeviceRead: createDeviceReadAuthorizer(),
    accept: async (batch) => defaultService.accept(batch),
    history: async (deviceId, limit) => storage().history(deviceId, limit),
    aggregate: async (deviceId) => storage().aggregate(deviceId),
  },
) {
  const router = Router();
  router.post("/ingestion/batches", async (request, response) => {
    const principal = await actor(request, dependencies.authenticate);
    if (
      !principal.service ||
      principal.clientId !== "algaguard-mqtt-ingestion-service"
    ) {
      throw new HttpError(403, "MQTT ingestion service token required");
    }
    const batch = batchSchema.parse(request.body);
    response.status(202).json(await dependencies.accept(batch));
  });

  async function authorizeRead(request: Request) {
    const principal = await actor(request, dependencies.authenticate);
    const deviceId = z
      .string()
      .regex(/^AG-[0-9]{6}$/)
      .parse(request.params.id);
    if (
      !(await dependencies.authorizeDeviceRead(principal.subjectId, deviceId))
    ) {
      throw new HttpError(403, "Telemetry read is not authorized");
    }
    return deviceId;
  }

  router.get("/devices/:id/telemetry", async (request, response) => {
    const deviceId = await authorizeRead(request);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .parse(request.query.limit);
    response.json({
      deviceId,
      items: await dependencies.history(deviceId, limit),
    });
  });
  router.get("/devices/:id/latest", async (request, response) => {
    const deviceId = await authorizeRead(request);
    const items = await dependencies.history(deviceId, 1);
    response.json({ deviceId, latest: items[0] ?? null });
  });
  router.get("/devices/:id/aggregate", async (request, response) => {
    const deviceId = await authorizeRead(request);
    response.json({
      deviceId,
      ...(await dependencies.aggregate(deviceId)),
    });
  });
  return router;
}

export const router = createRouter();
