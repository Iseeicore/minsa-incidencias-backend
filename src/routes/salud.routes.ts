import { Router } from "express";
import { HEALTH_PATH, HEALTH_READY_PATH } from "@/constants/limits.js";
import type { Database } from "@/database/database.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";

export function createSaludRouter(database: Database): Router {
  const router = Router();

  router.get(HEALTH_PATH, (_req, res) => {
    res.json({ estado: "ok" });
  });

  router.get(HEALTH_READY_PATH, async (req, res) => {
    try {
      await database.ping();
    } catch (error) {
      req.log.error({ err: error }, "la base de datos no responde");
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE);
    }
    res.json({ estado: "ok", baseDeDatos: "ok" });
  });

  return router;
}
