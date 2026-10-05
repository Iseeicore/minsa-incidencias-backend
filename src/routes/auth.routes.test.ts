import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { errorHandler } from "@/middleware/error-handler.js";
import { createAuthRouter } from "@/routes/auth.routes.js";
import type { AuthService } from "@/services/auth.service.js";
import type { SesionActual } from "@/services/auth.types.js";
import { testEnv } from "@/test-utils/env.js";

const sesion: SesionActual = {
  sesionId: "s-1",
  usuarioId: "u-1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  roles: ["GESTOR", "AREA_QUEJA"],
  vistas: [VistaCodigo.INICIO, VistaCodigo.CASOS],
};

describe("GET /auth/me", () => {
  it("devuelve nombre, correo y vistas, y nunca los roles ni los identificadores", async () => {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.sesion = sesion;
      Object.assign(req, { log: { error: () => undefined } });
      next();
    });
    app.use(createAuthRouter({} as AuthService, testEnv(), (_req, _res, next) => next()));
    app.use(errorHandler);

    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ nombreCompleto: "Ana Prueba", correo: "ana@minsa.gob.pe", vistas: ["INICIO", "CASOS"] });
    expect(JSON.stringify(res.body)).not.toContain("GESTOR");
    expect(JSON.stringify(res.body)).not.toContain("u-1");
  });
});
