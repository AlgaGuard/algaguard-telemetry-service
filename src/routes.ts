import { Router } from "express";
import { z } from "zod";
import { TelemetryService } from "./domain.js";
import { TelemetryRepository } from "./storage.js";
export const router = Router();
let repository: TelemetryRepository | undefined;
const storage = () => (repository ??= new TelemetryRepository());
const service = new TelemetryService(
  async (batch) => storage().persist(batch),
  async (event) => storage().publish(event),
);
const batchSchema = z.object({
  batchId: z.string().uuid(),
  deviceId: z.string().regex(/^AG-[0-9]{6}$/),
  samples: z
    .array(
      z.object({
        sequence: z.string().regex(/^[0-9]+$/),
        observedAt: z.string().datetime().optional(),
        values: z.record(z.string(), z.number()),
        qualityFlags: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(100),
});
router.post("/ingestion/batches", async (request, response) => {
  const batch = batchSchema.parse(request.body);
  response.status(202).json(await service.accept(batch));
});
router.get("/devices/:id/telemetry", async (request, response) => {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .parse(request.query.limit);
  response.json({
    deviceId: request.params.id,
    items: await storage().history(request.params.id, limit),
  });
});
router.get("/devices/:id/latest", async (request, response) => {
  const items = await storage().history(request.params.id, 1);
  response.json({ deviceId: request.params.id, latest: items[0] ?? null });
});
router.get("/devices/:id/aggregate", async (request, response) =>
  response.json({
    deviceId: request.params.id,
    ...(await storage().aggregate(request.params.id)),
  }),
);
