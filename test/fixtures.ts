import type {
  BatchOutcome,
  DeviceContext,
  TelemetryBatch,
} from "../src/domain.js";

export const batch: TelemetryBatch = {
  batchId: "10000000-0000-4000-8000-000000000001",
  deviceUuid: "20000000-0000-4000-8000-000000000001",
  deviceId: "AG-000001",
  organizationId: "60000000-0000-4000-8000-000000000001",
  ownershipVersion: "1",
  correlationId: "70000000-0000-4000-8000-000000000001",
  activeProfile: {
    profileId: "30000000-0000-4000-8000-000000000001",
    profileVersion: "1.0.0",
  },
  samples: [
    {
      sequence: "1",
      observedAt: "2026-07-23T00:00:00Z",
      timestampQuality: "NTP_SYNCED",
      uptimeMs: "1000",
      values: { ph: 7 },
    },
  ],
};

export const context: DeviceContext = {
  schema: "urn:algaguard:schema:internal:device-context:v1",
  schemaVersion: "1.0.0",
  deviceUuid: batch.deviceUuid,
  deviceId: batch.deviceId,
  organizationId: batch.organizationId,
  status: "ACTIVE",
  ownershipVersion: batch.ownershipVersion,
  resolvedAt: "2026-07-23T00:00:00Z",
  contextVersion: "1",
};

export const acceptedOutcome: BatchOutcome = {
  batchId: batch.batchId,
  deviceId: batch.deviceId,
  status: "ACCEPTED",
  acceptedThroughSequence: "1",
  duplicate: false,
  storedSamples: 1,
  receivedAt: "2026-07-23T00:00:01Z",
};
