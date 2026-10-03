import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { serviceToken } from "./authorization.js";
import {
  createServiceTokenProvider,
  metadataWithServiceToken,
} from "./grpc-client.js";
import type { DeviceContext } from "./domain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEVICE_STATUS_NAME: Record<number, "ACTIVE"> = { 5: "ACTIVE" };

const deviceContextSchema = z
  .object({
    schema: z.literal("urn:algaguard:schema:internal:device-context:v1"),
    schemaVersion: z.literal("1.0.0"),
    deviceUuid: z.string().uuid(),
    deviceId: z.string().regex(/^AG-[0-9]{6}$/),
    organizationId: z.string().uuid(),
    status: z.literal("ACTIVE"),
    ownershipVersion: z.string().regex(/^[1-9][0-9]{0,19}$/),
    resolvedAt: z.string().datetime(),
    tankId: z.string().uuid().optional(),
    contextVersion: z
      .string()
      .regex(/^[1-9][0-9]{0,19}$/)
      .optional(),
  })
  .strict();

export function createDeviceContextResolver(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const baseUrl =
    environment.DEVICE_SERVICE_URL ?? "http://device-service:3000";
  return async (deviceId: string): Promise<DeviceContext> => {
    const response = await fetch(
      `${baseUrl}/v1/internal/devices/by-device-id/${encodeURIComponent(deviceId)}/context`,
      {
        headers: {
          authorization: `Bearer ${await serviceToken(environment)}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Device context resolution failed with ${response.status}`,
      );
    }
    const context = deviceContextSchema.parse(await response.json());
    if (context.deviceId !== deviceId) {
      throw new Error("Device Service returned mismatched canonical identity");
    }
    return context;
  };
}

export function createGrpcDeviceContextResolver(
  address: string,
  environment: NodeJS.ProcessEnv = process.env,
  tokenProvider = createServiceTokenProvider(environment),
) {
  const protoPath = path.resolve(here, "..", "proto", "device_service.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
    includeDirs: [path.dirname(protoPath)],
  });
  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const client = new proto.algaguard.device.v1.DeviceLookupService(
    address,
    grpc.credentials.createInsecure(),
  );
  return async (deviceId: string): Promise<DeviceContext> => {
    const metadata = await metadataWithServiceToken(tokenProvider);
    const response = await new Promise<any>((resolve, reject) => {
      client.getContextByDeviceId(
        { deviceId },
        metadata,
        (error: grpc.ServiceError, value: unknown) =>
          error ? reject(error) : resolve(value),
      );
    });
    const context = deviceContextSchema.parse({
      schema: "urn:algaguard:schema:internal:device-context:v1",
      schemaVersion: "1.0.0",
      deviceUuid: response.deviceUuid,
      deviceId: response.deviceId,
      organizationId: response.organizationId,
      status: DEVICE_STATUS_NAME[response.status] ?? "ACTIVE",
      ownershipVersion: response.ownershipVersion,
      resolvedAt: response.resolvedAt,
      ...(response.tankId ? { tankId: response.tankId } : {}),
      ...(response.contextVersion
        ? { contextVersion: response.contextVersion }
        : {}),
    });
    if (context.deviceId !== deviceId) {
      throw new Error("Device Service returned mismatched canonical identity");
    }
    return context;
  };
}
