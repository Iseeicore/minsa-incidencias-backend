import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";
import { createAreasRouter } from "@/routes/areas.routes.js";
import type { AreaServicio } from "@/services/area.types.js";
import type { SesionActual } from "@/services/auth.types.js";
import { codificarCursorDeAreas } from "@/utils/cursor-areas.js";

const codificarTexto = (texto: string): string => Buffer.from(texto, "utf8").toString("base64url");

const sesion: SesionActual = {
  sesionId: "s1",
  usuarioId: "u1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  roles: ["GESTOR"],
  area: null,
  vistas: [VistaCodigo.CASOS],
};

function servicioFalso() {
  return { listar: vi.fn(async () => ({ items: [], siguiente: null, hayMas: false })) };
}

function montar(servicio: ReturnType<typeof servicioFalso>, sesionActual: SesionActual | null) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (sesionActual) req.sesion = sesionActual;
    Object.assign(req, { log: { error: () => undefined } });
    next();
  });
  app.use(createAreasRouter(servicio as unknown as AreaServicio));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("GET /areas", () => {
  let servicio: ReturnType<typeof servicioFalso>;
  beforeEach(() => {
    servicio = servicioFalso();
  });

  it("sin sesión responde 401 y no llega al servicio", async () => {
    expect((await request(montar(servicio, null)).get("/areas")).status).toBe(401);
    expect(servicio.listar).not.toHaveBeenCalled();
  });

  it("solo pide sesión: una persona sin vistas también lo consulta (el servicio acota lo que ve)", async () => {
    const res = await request(montar(servicio, { ...sesion, vistas: [] })).get("/areas");
    expect(res.status).toBe(200);
  });

  it("usa 50 por página, sin cursor ni filtros cuando no se piden", async () => {
    const res = await request(montar(servicio, sesion)).get("/areas");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], siguiente: null, hayMas: false });
    expect(servicio.listar).toHaveBeenCalledWith(sesion, { limite: 50 });
  });

  it("pasa el tipo, el texto recortado, el límite y el cursor ya decodificado", async () => {
    const posicion = { nombre: "Hospital Ñaña", id: 12 };
    await request(montar(servicio, sesion))
      .get("/areas")
      .query({ tipo: "ESTABLECIMIENTO", q: "  Peña ", limite: "200", cursor: codificarCursorDeAreas(posicion) });
    expect(servicio.listar).toHaveBeenCalledWith(sesion, { limite: 200, tipo: "ESTABLECIMIENTO", texto: "Peña", despuesDe: posicion });
  });

  it("un q vacío o de espacios equivale a no buscar", async () => {
    await request(montar(servicio, sesion)).get("/areas").query({ q: "   " });
    expect(servicio.listar).toHaveBeenCalledWith(sesion, { limite: 50 });
  });

  it.each([
    ["limite", "0"],
    ["limite", "-1"],
    ["limite", "abc"],
    ["limite", "201"],
    ["limite", "5.5"],
    ["tipo", "establecimiento"],
    ["tipo", "HOSPITAL"],
    ["q", "a".repeat(101)],
    ["cursor", "no es un cursor"],
    ["cursor", codificarTexto("1; DROP TABLE catalogo.area|Hospital")],
    ["cursor", codificarTexto("abc|Hospital")],
    ["cursor", "a".repeat(601)],
  ])("rechaza %s=%s con 400 y no llega al servicio", async (campo, valor) => {
    const res = await request(montar(servicio, sesion)).get("/areas").query({ [campo]: valor });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("VALIDATION_FAILED");
    expect(servicio.listar).not.toHaveBeenCalled();
  });
});
