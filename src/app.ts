import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
  type Router,
} from "express";
import { trace } from "@opentelemetry/api";
import pino from "pino";
import { HttpError } from "./auth.js";
import { router, storage } from "./routes.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.header("x-correlation-id");
  const correlationId =
    supplied && supplied.length <= 128 ? supplied : randomUUID();
  response.setHeader("x-correlation-id", correlationId);
  const span = trace
    .getTracer("algaguard-telemetry-service")
    .startSpan(`${request.method} ${request.path}`);
  const startedAt = Date.now();
  response.on("finish", () => {
    logger.info(
      {
        correlationId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "request completed",
    );
    span.end();
  });
  next();
};

export function buildApp(
  dependencies: {
    apiRouter?: Router;
    health?: () => Promise<void>;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(requestContext);
  app.get("/health/live", (_request, response) =>
    response.json({ status: "UP", service: "algaguard-telemetry-service" }),
  );
  app.get("/health/ready", async (_request, response) => {
    try {
      await (dependencies.health ?? (() => storage().health()))();
      response.json({
        status: "READY",
        service: "algaguard-telemetry-service",
        dependencies: { timescaledb: "UP" },
      });
    } catch {
      response.status(503).json({
        status: "NOT_READY",
        service: "algaguard-telemetry-service",
        dependencies: { timescaledb: "DOWN" },
      });
    }
  });
  app.use("/v1", dependencies.apiRouter ?? router);
  app.use((_request, response) =>
    response
      .status(404)
      .type("application/problem+json")
      .json({ type: "about:blank", title: "Not Found", status: 404 }),
  );
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    logger.error({ err: error }, "request failed");
    const status = error instanceof HttpError ? error.status : 500;
    response
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title:
          status === 401
            ? "Unauthorized"
            : status === 403
              ? "Forbidden"
              : "Internal Server Error",
        status,
      });
  };
  app.use(errors);
  return app;
}
