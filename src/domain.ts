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
export class TelemetryService {
  private readonly batchIds = new Set<string>();
  constructor(
    private readonly persist: (batch: TelemetryBatch) => Promise<void>,
    private readonly publish: (event: Record<string, unknown>) => Promise<void>,
  ) {}
  async accept(batch: TelemetryBatch) {
    if (this.batchIds.has(batch.batchId))
      return { status: "DUPLICATE" } as const;
    await this.persist(batch);
    this.batchIds.add(batch.batchId);
    await this.publish({
      eventType: "telemetry.updated",
      deviceId: batch.deviceId,
      payload: batch.samples.at(-1),
    });
    return { status: "ACCEPTED", storedSamples: batch.samples.length } as const;
  }
}
export function page<T>(values: T[], cursor = 0, limit = 50) {
  return {
    items: values.slice(cursor, cursor + Math.min(limit, 200)),
    nextCursor: cursor + limit < values.length ? cursor + limit : undefined,
  };
}
