import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Env } from "@/config/env.js";
import { MAX_PASSWORD_LENGTH, SECONDS_PER_HOUR } from "@/constants/limits.js";
import { requireSession } from "@/middleware/session.js";
import type { AuthService } from "@/services/auth.service.js";
import { clearSessionCookie, setSessionCookie } from "@/utils/session-cookie.js";

const loginSchema = z.object({
  correo: z.email(),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export function createAuthRouter(auth: AuthService, env: Env, loginLimiter: RequestHandler): Router {
  const router = Router();

  router.post("/auth/login", loginLimiter, async (req, res) => {
    const { correo, password } = loginSchema.parse(req.body);
    const sesionId = await auth.login(correo, password);

    if (req.sesion) await auth.cerrarSesion(req.sesion);
    setSessionCookie(res, env, sesionId, env.SESSION_ABSOLUTE_HOURS * SECONDS_PER_HOUR);
    res.status(204).end();
  });

  router.post("/auth/logout", async (req, res) => {
    if (req.sesion) await auth.cerrarSesion(req.sesion);
    clearSessionCookie(res, env);
    res.status(204).end();
  });

  router.get("/auth/me", requireSession, (req, res) => {
    const sesion = req.sesion as NonNullable<typeof req.sesion>;
    res.json({
      nombreCompleto: sesion.nombreCompleto,
      correo: sesion.correo,
      vistas: sesion.vistas,
    });
  });

  return router;
}
