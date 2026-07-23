export interface TelemetryBatch {
  batchId: string;
  deviceId: string;
  samples: Array<{
    sequence: string;
    observedAt?: string | undefined;
    values: Record<string, number>;
    qualityFlags?: string[] | undefined;
  }>;
}
export interface BatchOutcome {
  batchId: string;
  deviceId: string;
  status: "ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED" | "DUPLICATE";
  acceptedThroughSequence: string | null;
  duplicate: boolean;
  storedSamples: number;
  rejectedSequences?: string[];
  errors?: Array<{ code: string; message: string }>;
  receivedAt: string;
}
export class TelemetryService {
  constructor(
    private readonly persist: (batch: TelemetryBatch) => Promise<BatchOutcome>,
    private readonly publish: (event: Record<string, unknown>) => Promise<void>,
  ) {}
  async accept(batch: TelemetryBatch) {
    const outcome = await this.persist(batch);
    if (outcome.storedSamples > 0) {
      await this.publish({
        eventType: "telemetry.updated",
        deviceId: batch.deviceId,
        sequence: batch.samples.at(-1)?.sequence,
        payload: batch.samples.at(-1),
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
