import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { TipoArea } from "@/enums/tipo-area.enum.js";
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
  roles: ["GESTOR", "ESTABLECIMIENTO"],
  area: { id: 7, codigo: "EESS-6206", nombre: "Hospital Dos de Mayo", tipo: TipoArea.ESTABLECIMIENTO },
  vistas: [VistaCodigo.INICIO, VistaCodigo.CASOS],
};

describe("GET /auth/me", () => {
  const montar = (actual: SesionActual) => {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.sesion = actual;
      Object.assign(req, { log: { error: () => undefined } });
      next();
    });
    app.use(createAuthRouter({} as AuthService, testEnv(), (_req, _res, next) => next()));
    app.use(errorHandler);
    return app;
  };

  it("devuelve nombre, correo, vistas y área, y nunca los roles ni los identificadores", async () => {
    const res = await request(montar(sesion)).get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      nombreCompleto: "Ana Prueba",
      correo: "ana@minsa.gob.pe",
      vistas: ["INICIO", "CASOS"],
      area: { codigo: "EESS-6206", nombre: "Hospital Dos de Mayo", tipo: "ESTABLECIMIENTO" },
    });
    expect(JSON.stringify(res.body)).not.toContain("GESTOR");
    expect(JSON.stringify(res.body)).not.toContain("u-1");
    expect(res.body.area).not.toHaveProperty("id");
  });

  it("devuelve area null a quien no pertenece a ninguna", async () => {
    const res = await request(montar({ ...sesion, area: null })).get("/auth/me");
    expect(res.body.area).toBeNull();
  });
});
