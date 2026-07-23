import { randomUUID } from "node:crypto";

export interface TelemetrySample {
  sequence: string;
  observedAt?: string | undefined;
  timestampQuality: "NTP_SYNCED" | "RTC_HOLDOVER" | "UNSYNCED";
  uptimeMs: string;
  values: {
    temperatureC?: number | undefined;
    ph?: number | undefined;
    lightLux?: number | undefined;
    nitrateMgL?: number | undefined;
    phosphateMgL?: number | undefined;
    potassiumMgL?: number | undefined;
    batteryPercent?: number | undefined;
    batteryVoltageV?: number | undefined;
  };
  qualityFlags?: string[] | undefined;
  simulationScenario?: string | undefined;
  extensions?: Record<string, unknown> | undefined;
}

export interface TelemetryBatch {
  batchId: string;
  deviceUuid: string;
  deviceId: string;
  organizationId: string;
  ownershipVersion: string;
  correlationId?: string | undefined;
  activeProfile?: { profileId: string; profileVersion: string } | undefined;
  samples: TelemetrySample[];
}

export interface DeviceContext {
  schema: "urn:algaguard:schema:internal:device-context:v1";
  schemaVersion: "1.0.0";
  deviceUuid: string;
  deviceId: string;
  organizationId: string;
  status: "ACTIVE";
  ownershipVersion: string;
  resolvedAt: string;
  tankId?: string | undefined;
  contextVersion?: string | undefined;
}

export type DeviceContextResolver = (
  deviceId: string,
) => Promise<DeviceContext>;

export interface BatchOutcome {
  batchId: string;
  deviceId: string;
  status: "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED" | "DUPLICATE";
  acceptedThroughSequence: string | null;
  duplicate: boolean;
  storedSamples: number;
  rejectedSequences?: string[];
  errors?: Array<{ code: string; message: string; retryable: boolean }>;
  receivedAt: string;
}

export class StaleDeviceContextError extends Error {
  readonly status = 409;
  readonly code = "STALE_DEVICE_CONTEXT";

  constructor() {
    super("Trusted device context no longer matches Device Service");
  }
}

export class TelemetryService {
  constructor(
    private readonly persist: (batch: TelemetryBatch) => Promise<BatchOutcome>,
    private readonly publish: (event: Record<string, unknown>) => Promise<void>,
    private readonly resolveDeviceContext: DeviceContextResolver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async accept(batch: TelemetryBatch) {
    const current = await this.resolveDeviceContext(batch.deviceId);
    if (
      current.status !== "ACTIVE" ||
      current.deviceId !== batch.deviceId ||
      current.deviceUuid !== batch.deviceUuid ||
      current.organizationId !== batch.organizationId ||
      current.ownershipVersion !== batch.ownershipVersion
    ) {
      throw new StaleDeviceContextError();
    }

    const outcome = await this.persist(batch);
    if (outcome.storedSamples > 0) {
      const rejected = new Set(outcome.rejectedSequences ?? []);
      const committed = batch.samples.filter(
        (sample) => !rejected.has(sample.sequence),
      );
      const sample = committed.at(-1);
      if (!sample)
        throw new Error("Committed outcome omitted accepted samples");
      await this.publish({
        schema: "urn:algaguard:schema:internal:telemetry-committed:v1",
        schemaVersion: "1.0.0",
        eventId: randomUUID(),
        eventType: "telemetry.committed",
        occurredAt: this.now().toISOString(),
        organizationId: batch.organizationId,
        deviceUuid: batch.deviceUuid,
        deviceId: batch.deviceId,
        ownershipVersion: batch.ownershipVersion,
        batchId: batch.batchId,
        firstSequence: committed[0]!.sequence,
        lastSequence: sample.sequence,
        sampleCount: committed.length,
        payload: {
          sample,
          ...(batch.activeProfile
            ? { activeProfile: batch.activeProfile }
            : {}),
        },
        ...(batch.correlationId ? { correlationId: batch.correlationId } : {}),
      });
    }
    return outcome;
  }
}

export function page<T>(values: T[], cursor = 0, limit = 50) {
  return {
    items: values.slice(cursor, cursor + Math.min(limit, 200)),
    nextCursor: cursor + limit < values.length ? cursor + limit : undefined,
  };
}
