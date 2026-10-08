import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";
import { createFiltroCorrupcionRouter } from "@/routes/filtro-corrupcion.routes.js";
import type { SesionActual } from "@/services/auth.types.js";

const sesionCon = (roles: string[]): SesionActual => ({
  sesionId: "s1",
  usuarioId: "u1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  roles,
  area: null,
  vistas: [],
});

function montar(sesion: SesionActual | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (sesion) req.sesion = sesion;
    Object.assign(req, { log: { error: () => undefined } });
    next();
  });
  app.use(createFiltroCorrupcionRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const RUTA = "/filtro-corrupcion/evaluar";
const TEXTO = "El director del hospital me pidió plata para atenderme";

describe("POST /filtro-corrupcion/evaluar", () => {
  it("sin sesión responde 401", async () => {
    expect((await request(montar(null)).post(RUTA).send({ texto: TEXTO })).status).toBe(401);
  });

  it.each(["ESTABLECIMIENTO", "DIRIS"])("el rol %s no puede usarla: 403", async (rol) => {
    expect(
      (
        await request(montar(sesionCon([rol])))
          .post(RUTA)
          .send({ texto: TEXTO })
      ).status,
    ).toBe(403);
  });

  it.each(["ADMINISTRADOR", "GESTOR", "OTRANS"])("el rol %s recibe la propuesta", async (rol) => {
    const res = await request(montar(sesionCon([rol])))
      .post(RUTA)
      .send({ texto: TEXTO });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      aplica: true,
      puntaje: 4,
      certeza: "ALTA",
      propuestaCorrupcion: true,
      versionReglas: "reglas-corrupcion-v1",
    });
  });

  it("usa el catálogo y el contexto que recibe", async () => {
    const res = await request(montar(sesionCon(["GESTOR"])))
      .post(RUTA)
      .send({
        texto: "me pidieron coima en el Ministerio y tengo fotos",
        entidades: [{ codigo: "MINSA", nombre: "Ministerio de Salud", alias: ["ministerio"] }],
        tieneArchivos: true,
      });
    expect(res.body.entidad).toEqual({ codigo: "MINSA", nombre: "Ministerio de Salud" });
    expect(res.body.faltantes).toEqual(["AUTOR_O_CARGO"]);
  });

  it("un texto corto responde 200 con aplica en falso", async () => {
    const res = await request(montar(sesionCon(["GESTOR"])))
      .post(RUTA)
      .send({ texto: "hola" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ aplica: false, faltantes: ["DATOS_INSUFICIENTES"] });
  });

  it("rechaza con 400 un cuerpo sin texto o con texto demasiado largo", async () => {
    const app = montar(sesionCon(["GESTOR"]));
    expect((await request(app).post(RUTA).send({})).status).toBe(400);
    expect((await request(app).post(RUTA).send({ texto: 5 })).status).toBe(400);
    expect(
      (
        await request(app)
          .post(RUTA)
          .send({ texto: "a".repeat(5001) })
      ).status,
    ).toBe(400);
  });
});
