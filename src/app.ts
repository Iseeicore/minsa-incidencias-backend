import type { IncomingMessage, ServerResponse } from "node:http";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import type { Env } from "@/config/env.js";
import { createLogger } from "@/config/logger.js";
import { JSON_BODY_LIMIT, RATE_LIMIT_SWEEP_INTERVAL_MS } from "@/constants/limits.js";
import type { Database } from "@/database/database.js";
import { createCors } from "@/middleware/cors.js";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";
import { createGeneralResolver, rateLimit } from "@/middleware/rate-limit.js";
import { createSaludRouter } from "@/routes/salud.routes.js";
import { TokenBucketLimiter } from "@/utils/token-bucket.js";

function serializeRequest(req: IncomingMessage & { id?: unknown }) {
  return {
    id: req.id,
    method: req.method,
    url: req.url?.split("?")[0],
    remoteAddress: req.socket?.remoteAddress,
  };
}

function serializeResponse(res: ServerResponse) {
  return { statusCode: res.statusCode };
}

export function createApp(env: Env, database: Database, logger: Logger = createLogger(env)): Express {
  const limiter = new TokenBucketLimiter();
  setInterval(() => limiter.sweep(), RATE_LIMIT_SWEEP_INTERVAL_MS).unref();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(pinoHttp({ logger, serializers: { req: serializeRequest, res: serializeResponse } }));
  app.use(helmet());
  app.use(createCors(env));
  app.use(createSaludRouter(database));
  app.use(rateLimit(limiter, createGeneralResolver(env)));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(cookieParser(env.COOKIE_SECRET));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
