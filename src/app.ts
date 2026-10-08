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
import { createGeneralResolver, createLoginResolver, rateLimit } from "@/middleware/rate-limit.js";
import { attachSession } from "@/middleware/session.js";
import { IncidenciaRepository } from "@/repositories/incidencia.repository.js";
import { SesionRepository } from "@/repositories/sesion.repository.js";
import { UsuarioRepository } from "@/repositories/usuario.repository.js";
import { createAuthRouter } from "@/routes/auth.routes.js";
import { createFiltroCorrupcionRouter } from "@/routes/filtro-corrupcion.routes.js";
import { createIncidenciasRouter } from "@/routes/incidencias.routes.js";
import { createSaludRouter } from "@/routes/salud.routes.js";
import { AuthService } from "@/services/auth.service.js";
import { IncidenciaService, plazosDeEntorno } from "@/services/incidencia.service.js";
import { ArgonPasswordHasher, type PasswordHasher } from "@/utils/password-hasher.js";
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

export function createApp(
  env: Env,
  database: Database,
  logger: Logger = createLogger(env),
  hasher: PasswordHasher = new ArgonPasswordHasher(),
): Express {
  const limiter = new TokenBucketLimiter();
  setInterval(() => limiter.sweep(), RATE_LIMIT_SWEEP_INTERVAL_MS).unref();

  const auth = new AuthService(new UsuarioRepository(database), new SesionRepository(database), hasher, env);
  const incidencias = new IncidenciaService(new IncidenciaRepository(database), database, plazosDeEntorno(env));

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(pinoHttp({ logger, serializers: { req: serializeRequest, res: serializeResponse } }));
  app.use(helmet());
  app.use(createCors(env));
  app.use(createSaludRouter(database));
  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(attachSession(auth, env));
  app.use(rateLimit(limiter, createGeneralResolver(env, (req) => req.sesion?.usuarioId ?? null)));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(createAuthRouter(auth, env, rateLimit(limiter, createLoginResolver(env))));
  app.use(createIncidenciasRouter(incidencias));
  app.use(createFiltroCorrupcionRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
