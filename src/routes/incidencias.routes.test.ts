import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { codificarCursor } from "@/utils/cursor-listado.js";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";
import { createIncidenciasRouter } from "@/routes/incidencias.routes.js";
import type { IncidenciaServicio } from "@/services/incidencia.types.js";
import type { SesionActual } from "@/services/auth.types.js";

const CODIGO = "MINSA-2026-000001";
const codificarTexto = (texto: string): string => Buffer.from(texto, "utf8").toString("base64url");

const sesionConCasos: SesionActual = {
  sesionId: "s1",
  usuarioId: "u1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  roles: ["GESTOR"],
  area: null,
  vistas: [VistaCodigo.CASOS],
};

function servicioFalso() {
  return {
    listar: vi.fn(async () => ({ items: [], siguiente: null, hayMas: false })),
    detalle: vi.fn(async () => ({ codigo: CODIGO })),
    porVencer: vi.fn(async () => ({ total: 0, porVencer: 0, vencidos: 0, casos: [] })),
    ejecutar: vi.fn(async () => ({ mensaje: "listo", caso: null })),
  };
}

function montar(servicio: ReturnType<typeof servicioFalso>, sesion: SesionActual | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (sesion) req.sesion = sesion;
    Object.assign(req, { log: { error: () => undefined } });
    next();
  });
  app.use(createIncidenciasRouter(servicio as unknown as IncidenciaServicio));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("rutas de incidencias", () => {
  let servicio: ReturnType<typeof servicioFalso>;
  beforeEach(() => {
    servicio = servicioFalso();
  });

  describe("acceso", () => {
    it("sin sesión responde 401 en todas las rutas", async () => {
      const app = montar(servicio, null);
      expect((await request(app).get("/incidencias")).status).toBe(401);
      expect((await request(app).get("/incidencias/por-vencer")).status).toBe(401);
      expect((await request(app).get(`/incidencias/${CODIGO}`)).status).toBe(401);
      expect((await request(app).post(`/incidencias/${CODIGO}/confirmar`)).status).toBe(401);
      expect(servicio.listar).not.toHaveBeenCalled();
    });

    it("sin la vista de casos responde 403, pero la campana de avisos solo pide sesión", async () => {
      const app = montar(servicio, { ...sesionConCasos, vistas: [] });
      expect((await request(app).get("/incidencias")).status).toBe(403);
      expect((await request(app).get(`/incidencias/${CODIGO}`)).status).toBe(403);
      expect((await request(app).post(`/incidencias/${CODIGO}/tomar`)).status).toBe(403);
      expect((await request(app).get("/incidencias/por-vencer")).status).toBe(200);
    });
  });

  describe("GET /incidencias", () => {
    it("usa 20 por página, sin cursor ni filtros cuando no se piden", async () => {
      const res = await request(montar(servicio, sesionConCasos)).get("/incidencias");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], siguiente: null, hayMas: false });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, { limite: 20 });
    });

    it("pasa los filtros, el límite y el cursor ya validados y decodificados", async () => {
      const posicion = { fechaCreacion: new Date("2026-10-05T12:00:00.123Z"), id: "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b" };
      await request(montar(servicio, sesionConCasos))
        .get("/incidencias")
        .query({ limite: "5", cursor: codificarCursor(posicion), estado: "derivado", categoria: "queja", texto: "  hola  " });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, {
        limite: 5,
        despuesDe: posicion,
        estado: "derivado",
        categoria: "queja",
        texto: "hola",
      });
    });

    it("ya no acepta pagina, tamano ni orden: se ignoran y el listado sigue del más nuevo al más antiguo", async () => {
      await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ pagina: "3", tamano: "5", orden: "codigo" });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, { limite: 20 });
    });

    it("acepta filtrar los casos sin categoría", async () => {
      await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ categoria: "sin-categoria" });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, expect.objectContaining({ categoria: "sin-categoria" }));
    });

    it.each([
      ["limite", "0"],
      ["limite", "-1"],
      ["limite", "abc"],
      ["limite", "101"],
      ["limite", "20.5"],
      ["cursor", "no es un cursor"],
      ["cursor", "MjAyNi0xMC0wNXxubw"],
      ["cursor", codificarTexto("2026-10-05T12:00:00.000Z|1; DROP TABLE chatbot.incidencia_paciente")],
      ["cursor", codificarTexto("no-es-fecha|0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b")],
      ["cursor", "a".repeat(201)],
      ["estado", "anulado"],
      ["categoria", "corrupcion"],
    ])("rechaza %s=%s con 400 y no llega al servicio", async (campo, valor) => {
      const res = await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ [campo]: valor });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      expect(servicio.listar).not.toHaveBeenCalled();
    });

    it("rechaza un texto de búsqueda demasiado largo", async () => {
      const res = await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ texto: "a".repeat(101) });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /incidencias/por-vencer", () => {
    it("va antes que la ruta por código", async () => {
      const res = await request(montar(servicio, sesionConCasos)).get("/incidencias/por-vencer");
      expect(res.status).toBe(200);
      expect(servicio.porVencer).toHaveBeenCalledWith(sesionConCasos);
      expect(servicio.detalle).not.toHaveBeenCalled();
    });
  });

  describe("GET /incidencias/:codigo", () => {
    it("pide el detalle por código", async () => {
      const res = await request(montar(servicio, sesionConCasos)).get(`/incidencias/${CODIGO}`);
      expect(res.status).toBe(200);
      expect(servicio.detalle).toHaveBeenCalledWith(sesionConCasos, CODIGO);
    });

    it.each(["abc", "MINSA-26-000001", "minsa-2026-000001", "MINSA-2026-1", "MINSA-2026-000001%27"])(
      "un código con forma inválida (%s) responde 404 sin llegar al servicio",
      async (codigo) => {
        const res = await request(montar(servicio, sesionConCasos)).get(`/incidencias/${codigo}`);
        expect(res.status).toBe(404);
        expect(servicio.detalle).not.toHaveBeenCalled();
      },
    );
  });

  describe("acciones", () => {
    it.each(["confirmar", "derivar", "tomar"] as const)("POST /%s no necesita cuerpo", async (accion) => {
      const res = await request(montar(servicio, sesionConCasos)).post(`/incidencias/${CODIGO}/${accion}`);
      expect(res.status).toBe(200);
      expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, accion, {});
    });

    it("corregir exige la categoría nueva y rechaza una que no existe", async () => {
      const app = montar(servicio, sesionConCasos);
      expect((await request(app).post(`/incidencias/${CODIGO}/corregir`).send({})).status).toBe(400);
      expect((await request(app).post(`/incidencias/${CODIGO}/corregir`).send({ categoria: "sin-categoria" })).status).toBe(400);
      expect((await request(app).post(`/incidencias/${CODIGO}/corregir`).send({ categoria: "inventada" })).status).toBe(400);
      expect(servicio.ejecutar).not.toHaveBeenCalled();

      const ok = await request(app).post(`/incidencias/${CODIGO}/corregir`).send({ categoria: "otro" });
      expect(ok.status).toBe(200);
      expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "corregir", { categoria: "otro" });
    });

    it("resolver exige un texto de resolución, lo recorta y pone un tope", async () => {
      const app = montar(servicio, sesionConCasos);
      expect((await request(app).post(`/incidencias/${CODIGO}/resolver`).send({})).status).toBe(400);
      expect((await request(app).post(`/incidencias/${CODIGO}/resolver`).send({ resolucion: "   " })).status).toBe(400);
      expect((await request(app).post(`/incidencias/${CODIGO}/resolver`).send({ resolucion: "x".repeat(4001) })).status).toBe(400);
      expect(servicio.ejecutar).not.toHaveBeenCalled();

      const ok = await request(app).post(`/incidencias/${CODIGO}/resolver`).send({ resolucion: "  Se entregó la copia.  " });
      expect(ok.status).toBe(200);
      expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "resolver", { resolucion: "Se entregó la copia." });
    });

    it("ignora campos de más en el cuerpo de las acciones sin datos", async () => {
      await request(montar(servicio, sesionConCasos)).post(`/incidencias/${CODIGO}/tomar`).send({ estado: "resuelto", actor: "otro" });
      expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "tomar", {});
    });

    it("derivar acepta el código del área de destino, lo recorta y descarta lo demás", async () => {
      const app = montar(servicio, sesionConCasos);
      const ok = await request(app).post(`/incidencias/${CODIGO}/derivar`).send({ areaDestino: "  EESS-6206 ", areaDestinoId: 7 });
      expect(ok.status).toBe(200);
      expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "derivar", { areaDestino: "EESS-6206" });
    });

    it.each([[""], ["   "], [123], ["x".repeat(51)]])("derivar rechaza un área de destino inválida (%j)", async (areaDestino) => {
      const res = await request(montar(servicio, sesionConCasos)).post(`/incidencias/${CODIGO}/derivar`).send({ areaDestino });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      expect(servicio.ejecutar).not.toHaveBeenCalled();
    });

    it("un código con forma inválida responde 404 sin llegar al servicio", async () => {
      const res = await request(montar(servicio, sesionConCasos)).post("/incidencias/abc/confirmar");
      expect(res.status).toBe(404);
      expect(servicio.ejecutar).not.toHaveBeenCalled();
    });

    it("una acción que no existe responde 404", async () => {
      const res = await request(montar(servicio, sesionConCasos)).post(`/incidencias/${CODIGO}/archivar`);
      expect(res.status).toBe(404);
      expect(servicio.ejecutar).not.toHaveBeenCalled();
    });
  });
});
