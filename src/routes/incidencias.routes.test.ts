import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";
import { createIncidenciasRouter } from "@/routes/incidencias.routes.js";
import type { IncidenciaServicio } from "@/services/incidencia.types.js";
import type { SesionActual } from "@/services/auth.types.js";

const CODIGO = "MINSA-2026-000001";

const sesionConCasos: SesionActual = {
  sesionId: "s1",
  usuarioId: "u1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  roles: ["GESTOR"],
  vistas: [VistaCodigo.CASOS],
};

function servicioFalso() {
  return {
    listar: vi.fn(async () => ({ casos: [], pagina: 1, tamano: 20, total: 0 })),
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
    it("usa 20 por página, lo más antiguo primero y sin filtros cuando no se piden", async () => {
      const res = await request(montar(servicio, sesionConCasos)).get("/incidencias");
      expect(res.status).toBe(200);
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, {
        pagina: 1,
        tamano: 20,
        orden: "fecha",
        direccion: "asc",
      });
    });

    it("pasa los filtros, el orden y la paginación ya validados", async () => {
      await request(montar(servicio, sesionConCasos))
        .get("/incidencias")
        .query({ pagina: "2", tamano: "5", estado: "derivado", categoria: "queja", texto: "  hola  ", orden: "codigo", direccion: "desc" });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, {
        pagina: 2,
        tamano: 5,
        estado: "derivado",
        categoria: "queja",
        texto: "hola",
        orden: "codigo",
        direccion: "desc",
      });
    });

    it("acepta filtrar los casos sin categoría", async () => {
      await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ categoria: "sin-categoria" });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, expect.objectContaining({ categoria: "sin-categoria" }));
    });

    it.each([
      ["pagina", "0"],
      ["pagina", "-1"],
      ["pagina", "abc"],
      ["tamano", "0"],
      ["tamano", "101"],
      ["tamano", "20.5"],
      ["estado", "anulado"],
      ["categoria", "corrupcion"],
      ["orden", "descripcion"],
      ["orden", "codigo; DROP TABLE chatbot.incidencia_paciente"],
      ["direccion", "arriba"],
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
      await request(montar(servicio, sesionConCasos)).post(`/incidencias/${CODIGO}/derivar`).send({ estado: "resuelto", actor: "otro" });
      expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "derivar", {});
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
