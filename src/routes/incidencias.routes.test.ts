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

    it("acepta filtrar la bandeja de archivados por estado y por motivo del archivo", async () => {
      await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ estado: "archivado", motivoArchivo: "NO_CORRESPONDE" });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, { limite: 20, estado: "archivado", motivoArchivo: "NO_CORRESPONDE" });
      for (const motivo of ["DATOS_INSUFICIENTES", "VENCIDA_SIN_ATENDER", "RESUELTA_VIGENCIA"]) {
        const res = await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ motivoArchivo: motivo });
        expect(res.status).toBe(200);
      }
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
      ["motivoArchivo", "otro"],
      ["motivoArchivo", "no_corresponde"],
      ["categoria", "corrupcion"],
    ])("rechaza %s=%s con 400 y no llega al servicio", async (campo, valor) => {
      const res = await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ [campo]: valor });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      expect(servicio.listar).not.toHaveBeenCalled();
    });

    it("pasa el establecimiento con el código canónico: sin ceros a la izquierda ni espacios", async () => {
      const app = montar(servicio, sesionConCasos);
      for (const entrada of ["6206", "0006206", "  00006206 ", "12345678"]) {
        servicio.listar.mockClear();
        const res = await request(app).get("/incidencias").query({ establecimiento: entrada });
        expect(res.status).toBe(200);
        expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, { limite: 20, establecimiento: entrada.trim().replace(/^0+/, "") });
      }
    });

    it("un establecimiento vacío equivale a no filtrar y viaja junto al cursor", async () => {
      await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ establecimiento: "" });
      expect(servicio.listar).toHaveBeenCalledWith(sesionConCasos, { limite: 20 });

      const posicion = { fechaCreacion: new Date("2026-10-05T12:00:00.123Z"), id: "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b" };
      await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ establecimiento: "0123", cursor: codificarCursor(posicion) });
      expect(servicio.listar).toHaveBeenLastCalledWith(sesionConCasos, { limite: 20, despuesDe: posicion, establecimiento: "123" });
    });

    it.each(["abc", "0", "000", "123456789", "000123456789", "12 34", "-5", "1e3", "12.5", "1'; DROP TABLE x"])(
      "rechaza establecimiento=%s con 400 y no llega al servicio",
      async (valor) => {
        const res = await request(montar(servicio, sesionConCasos)).get("/incidencias").query({ establecimiento: valor });
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        expect(servicio.listar).not.toHaveBeenCalled();
      },
    );

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

    describe("resolver", () => {
      const completa = { medidasTomadas: "  Se entregó la copia del expediente.  ", fundamento: "Lo pidió el paciente.", resultado: "ATENDIDO" };

      it("exige las medidas, el fundamento y el resultado; los recorta y pone un tope", async () => {
        const app = montar(servicio, sesionConCasos);
        const resolver = (cuerpo: object) => request(app).post(`/incidencias/${CODIGO}/resolver`).send(cuerpo);
        expect((await resolver({})).status).toBe(400);
        expect((await resolver({ resolucion: "Se entregó la copia." })).status).toBe(400);
        expect((await resolver({ ...completa, medidasTomadas: undefined })).status).toBe(400);
        expect((await resolver({ ...completa, fundamento: undefined })).status).toBe(400);
        expect((await resolver({ ...completa, resultado: undefined })).status).toBe(400);
        expect((await resolver({ ...completa, medidasTomadas: "   corta   " })).status).toBe(400);
        expect((await resolver({ ...completa, fundamento: "123456789" })).status).toBe(400);
        expect((await resolver({ ...completa, medidasTomadas: "x".repeat(4001) })).status).toBe(400);
        expect((await resolver({ ...completa, fundamento: "x".repeat(4001) })).status).toBe(400);
        expect((await resolver({ ...completa, resultado: "ARCHIVADO" })).status).toBe(400);
        expect((await resolver({ ...completa, resultado: "atendido" })).status).toBe(400);
        expect(servicio.ejecutar).not.toHaveBeenCalled();

        const ok = await resolver(completa);
        expect(ok.status).toBe(200);
        expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "resolver", {
          medidasTomadas: "Se entregó la copia del expediente.",
          fundamento: "Lo pidió el paciente.",
          resultado: "ATENDIDO",
        });
      });

      it("acepta el resultado CERRADO y descarta los campos de más", async () => {
        await request(montar(servicio, sesionConCasos))
          .post(`/incidencias/${CODIGO}/resolver`)
          .send({ ...completa, resultado: "CERRADO", resolucion: "viejo", estado: "resuelto" });
        expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "resolver", {
          medidasTomadas: "Se entregó la copia del expediente.",
          fundamento: "Lo pidió el paciente.",
          resultado: "CERRADO",
        });
      });
    });

    describe("archivar", () => {
      const archivar = (app: ReturnType<typeof montar>, cuerpo: object) => request(app).post(`/incidencias/${CODIGO}/archivar`).send(cuerpo);

      it.each([
        ["sin cuerpo", {}],
        ["sin detalle", { motivo: "NO_CORRESPONDE" }],
        ["sin motivo", { detalle: "No es de este establecimiento." }],
        ["con detalle de espacios", { motivo: "NO_CORRESPONDE", detalle: "            " }],
        ["con detalle de menos de 10 caracteres", { motivo: "NO_CORRESPONDE", detalle: " corto " }],
        ["con detalle demasiado largo", { motivo: "DATOS_INSUFICIENTES", detalle: "x".repeat(2001) }],
        ["con un motivo que el sistema pone solo (vencida)", { motivo: "VENCIDA_SIN_ATENDER", detalle: "Vencida hace tiempo ya." }],
        ["con un motivo que el sistema pone solo (vigencia)", { motivo: "RESUELTA_VIGENCIA", detalle: "Resuelta hace tiempo ya." }],
        ["con un motivo en minúsculas", { motivo: "no_corresponde", detalle: "No es de este establecimiento." }],
        ["con un detalle que no es texto", { motivo: "NO_CORRESPONDE", detalle: 12345678901 }],
      ])("rechaza %s con 400 y no llega al servicio", async (_nombre, cuerpo) => {
        const res = await archivar(montar(servicio, sesionConCasos), cuerpo);
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        expect(servicio.ejecutar).not.toHaveBeenCalled();
      });

      it.each(["DATOS_INSUFICIENTES", "NO_CORRESPONDE"])("acepta el motivo %s, recorta el detalle y descarta lo demás", async (motivo) => {
        const res = await archivar(montar(servicio, sesionConCasos), { motivo, detalle: "  Faltan los datos de contacto.  ", estado: "archivado" });
        expect(res.status).toBe(200);
        expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "archivar", {
          motivoArchivo: motivo,
          detalle: "Faltan los datos de contacto.",
        });
      });
    });

    describe("reabrir", () => {
      const reabrir = (app: ReturnType<typeof montar>, cuerpo: object) => request(app).post(`/incidencias/${CODIGO}/reabrir`).send(cuerpo);

      it.each([
        ["sin cuerpo", {}],
        ["con motivo vacío", { motivo: "   " }],
        ["con motivo de menos de 10 caracteres", { motivo: "corto" }],
        ["con motivo demasiado largo", { motivo: "x".repeat(2001) }],
        ["con motivo que no es texto", { motivo: 5 }],
        ["con el campo equivocado", { detalle: "Llegaron los datos pedidos." }],
      ])("rechaza %s con 400 y no llega al servicio", async (_nombre, cuerpo) => {
        const res = await reabrir(montar(servicio, sesionConCasos), cuerpo);
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        expect(servicio.ejecutar).not.toHaveBeenCalled();
      });

      it("pasa el motivo recortado", async () => {
        const res = await reabrir(montar(servicio, sesionConCasos), { motivo: "  Llegaron los datos pedidos.  " });
        expect(res.status).toBe(200);
        expect(servicio.ejecutar).toHaveBeenCalledWith(sesionConCasos, CODIGO, "reabrir", { motivoReapertura: "Llegaron los datos pedidos." });
      });
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
      const res = await request(montar(servicio, sesionConCasos)).post(`/incidencias/${CODIGO}/anular`);
      expect(res.status).toBe(404);
      expect(servicio.ejecutar).not.toHaveBeenCalled();
    });
  });
});
