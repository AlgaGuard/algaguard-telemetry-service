import { Router, type Request } from "express";
import { z } from "zod";
import { createAuthenticator, HttpError, type Authenticator } from "./auth.js";
import {
  createDeviceReadAuthorizer,
  type DeviceReadAuthorizer,
} from "./authorization.js";
import { createDeviceContextResolver } from "./device-context.js";
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
  createDeviceContextResolver(),
);

export interface RouteDependencies {
  authenticate: Authenticator;
  authorizeDeviceRead: DeviceReadAuthorizer;
  accept(batch: TelemetryBatch): Promise<BatchOutcome>;
  history(
    deviceUuid: string,
    organizationId: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>>;
  aggregate(
    deviceUuid: string,
    organizationId: string,
  ): Promise<Record<string, unknown>>;
}

const decimalSequence = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const extensionMap = z.record(z.string(), z.unknown());
const parameterValues = z
  .object({
    temperatureC: z.number().optional(),
    ph: z.number().min(0).max(14).optional(),
    lightLux: z.number().min(0).optional(),
    nitrateMgL: z.number().min(0).optional(),
    phosphateMgL: z.number().min(0).optional(),
    potassiumMgL: z.number().min(0).optional(),
    batteryPercent: z.number().min(0).max(100).optional(),
    batteryVoltageV: z.number().min(0).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "values must not be empty");
const qualityFlag = z.enum([
  "SIMULATED",
  "SENSOR_UNAVAILABLE",
  "OUT_OF_EXPECTED_RANGE",
  "CLOCK_UNSYNCED",
  "SD_RECOVERED",
  "ESTIMATED",
]);
const telemetrySample = z
  .object({
    sequence: decimalSequence,
    observedAt: z.string().datetime().optional(),
    timestampQuality: z.enum(["NTP_SYNCED", "RTC_HOLDOVER", "UNSYNCED"]),
    uptimeMs: decimalSequence,
    values: parameterValues,
    qualityFlags: z.array(qualityFlag).max(6).optional(),
    simulationScenario: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    extensions: extensionMap.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.timestampQuality === "UNSYNCED" && value.observedAt) {
      context.addIssue({
        code: "custom",
        message: "UNSYNCED samples omit observedAt",
      });
    }
    if (value.timestampQuality !== "UNSYNCED" && !value.observedAt) {
      context.addIssue({
        code: "custom",
        message: "synchronized samples require observedAt",
      });
    }
    if (
      value.qualityFlags?.includes("SIMULATED") &&
      !value.simulationScenario
    ) {
      context.addIssue({
        code: "custom",
        message: "simulated samples require simulationScenario",
      });
    }
  });

const batchSchema = z
  .object({
    batchId: z.string().uuid(),
    deviceUuid: z.string().uuid(),
    deviceId: z.string().regex(/^AG-[0-9]{6}$/),
    organizationId: z.string().uuid(),
    ownershipVersion: z.string().regex(/^[1-9][0-9]{0,19}$/),
    correlationId: z.string().uuid(),
    activeProfile: z
      .object({
        profileId: z.string().uuid(),
        profileVersion: z
          .string()
          .regex(
            /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
          ),
      })
      .strict()
      .optional(),
    samples: z.array(telemetrySample).min(1).max(120),
  })
  .strict();

async function actor(request: Request, authenticate: Authenticator) {
  return authenticate(request.header("authorization"));
}

export function createRouter(
  dependencies: RouteDependencies = {
    authenticate: createAuthenticator(),
    authorizeDeviceRead: createDeviceReadAuthorizer(),
    accept: async (batch) => defaultService.accept(batch),
    history: async (deviceUuid, organizationId, limit) =>
      storage().history(deviceUuid, organizationId, limit),
    aggregate: async (deviceUuid, organizationId) =>
      storage().aggregate(deviceUuid, organizationId),
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
    const deviceUuid = z.string().uuid().parse(request.params.id);
    const decision = await dependencies.authorizeDeviceRead(
      principal.subjectId,
      deviceUuid,
    );
    if (!decision.allowed) {
      throw new HttpError(403, "Telemetry read is not authorized");
    }
    const organizationId = z.string().uuid().safeParse(decision.organizationId);
    if (!organizationId.success) {
      throw new HttpError(403, "Authorized organization context is required");
    }
    return { deviceUuid, organizationId: organizationId.data };
  }

  router.get("/devices/:id/telemetry", async (request, response) => {
    const { deviceUuid, organizationId } = await authorizeRead(request);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)
      .parse(request.query.limit);
    response.json({
      deviceUuid,
      items: await dependencies.history(deviceUuid, organizationId, limit),
    });
  });
  router.get("/devices/:id/latest", async (request, response) => {
    const { deviceUuid, organizationId } = await authorizeRead(request);
    const items = await dependencies.history(deviceUuid, organizationId, 1);
    response.json({ deviceUuid, latest: items[0] ?? null });
  });
  router.post("/devices/latest-batch", async (request, response) => {
    const principal = await actor(request, dependencies.authenticate);
    const input = z
      .object({ deviceUuids: z.array(z.string().uuid()).min(1).max(200) })
      .strict()
      .parse(request.body);
    const items = (
      await Promise.all(
        input.deviceUuids.map(async (deviceUuid) => {
          const decision = await dependencies.authorizeDeviceRead(
            principal.subjectId,
            deviceUuid,
          );
          const organizationId = z
            .string()
            .uuid()
            .safeParse(decision.organizationId);
          if (!decision.allowed || !organizationId.success) return undefined;
          const history = await dependencies.history(
            deviceUuid,
            organizationId.data,
            1,
          );
          return { deviceUuid, latest: history[0] ?? null };
        }),
      )
    ).filter((item) => item !== undefined);
    response.json({ items });
  });
  router.get("/devices/:id/aggregate", async (request, response) => {
    const { deviceUuid, organizationId } = await authorizeRead(request);
    response.json({
      deviceUuid,
      ...(await dependencies.aggregate(deviceUuid, organizationId)),
    });
  });
  return router;
}

export const router = createRouter();
