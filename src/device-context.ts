import { z } from "zod";
import { serviceToken } from "./authorization.js";
import type { DeviceContext } from "./domain.js";

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
