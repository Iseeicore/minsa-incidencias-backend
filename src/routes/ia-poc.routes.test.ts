import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "@/app.js";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";
import { createIaPocRouter, type Analizador } from "@/routes/ia-poc.routes.js";
import type { SesionActual } from "@/services/auth.types.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type { ClienteModelo } from "@/services/analisis-ia/analisis-ia.types.js";
import { createFakeDatabase } from "@/test-utils/fake-database.js";
import { testEnv } from "@/test-utils/env.js";

const sesionCon = (roles: string[]): SesionActual => ({
  sesionId: "s1",
  usuarioId: "u1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  roles,
  area: null,
  vistas: [],
});

const RUTA = "/ia-poc/analizar";
const TEXTO = "El director del hospital me pidió plata para atenderme";
const clienteCaido: ClienteModelo = {
  consultar: async () => ({
    ok: false,
    motivo: "SIN_CONEXION",
    metricas: {
      intentos: 1,
      duracionMs: 1,
      totalOllamaMs: null,
      cargaModeloMs: null,
      procesoPromptMs: null,
      generacionMs: null,
      tokensPrompt: null,
      tokensSalida: null,
    },
  }),
};
const analizadorSinRed: Analizador = (texto, contexto, opciones) =>
  analizarMensaje(texto, contexto, { ...opciones, cliente: clienteCaido });

function montar(
  sesion: SesionActual | null,
  analizador: Analizador = analizadorSinRed,
) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (sesion) req.sesion = sesion;
    Object.assign(req, { log: { error: () => undefined } });
    next();
  });
  app.use(createIaPocRouter(analizador));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("POST /ia-poc/analizar", () => {
  it("sin sesión responde 401 y los roles distintos de ADMINISTRADOR, 403", async () => {
    expect(
      (await request(montar(null)).post(RUTA).send({ texto: TEXTO })).status,
    ).toBe(401);
    for (const rol of ["GESTOR", "OTRANS", "ESTABLECIMIENTO", "DIRIS"])
      expect(
        (
          await request(montar(sesionCon([rol])))
            .post(RUTA)
            .send({ texto: TEXTO })
        ).status,
      ).toBe(403);
  });

  it("el administrador recibe el paquete; con el modelo caído queda degradado y propone según las reglas", async () => {
    const res = await request(montar(sesionCon(["ADMINISTRADOR"])))
      .post(RUTA)
      .send({ texto: TEXTO });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      propuesta: "DENUNCIA_CORRUPCION",
      degradado: true,
      requiereOtrans: true,
      pesoIa: null,
      variante: "V2",
    });
    expect(res.body.confianza).toBeLessThan(100);
  });

  it("pasa la variante y el establecimiento al análisis", async () => {
    const analizador = vi.fn<Analizador>(analizadorSinRed);
    await request(montar(sesionCon(["ADMINISTRADOR"]), analizador))
      .post(RUTA)
      .send({ texto: TEXTO, variante: "V3", establecimiento: "Hospital X" });
    expect(analizador).toHaveBeenCalledWith(
      TEXTO,
      { establecimiento: "Hospital X", establecimientoConocido: true },
      { variante: "V3" },
    );
  });

  it("acepta la variante V2C y devuelve el paquete armado por plantillas", async () => {
    const res = await request(montar(sesionCon(["ADMINISTRADOR"])))
      .post(RUTA)
      .send({ texto: TEXTO, variante: "V2C" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      variante: "V2C",
      degradado: true,
      propuesta: "DENUNCIA_CORRUPCION",
      sinDesempateQuejaReclamo: false,
    });
    expect(res.body.explicacion).toContain("Las reglas suman");
  });

  it("acepta la variante V2R y, si hay recuperador de casos, se lo pasa al análisis", async () => {
    const recuperarCasos = async () => ({
      casos: [],
      casiDuplicadosDescartados: 0,
    });
    const analizador = vi.fn<Analizador>(analizadorSinRed);
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.sesion = sesionCon(["ADMINISTRADOR"]);
      Object.assign(req, { log: { error: () => undefined } });
      next();
    });
    app.use(createIaPocRouter(analizador, recuperarCasos));
    app.use(notFoundHandler);
    app.use(errorHandler);
    const res = await request(app)
      .post(RUTA)
      .send({ texto: TEXTO, variante: "V2R" });
    expect(res.status).toBe(200);
    expect(analizador).toHaveBeenCalledWith(
      TEXTO,
      {},
      { variante: "V2R", recuperarCasos },
    );
  });

  it("V2R sin recuperador corre sin ejemplos y responde el paquete", async () => {
    const res = await request(montar(sesionCon(["ADMINISTRADOR"])))
      .post(RUTA)
      .send({ texto: TEXTO, variante: "V2R" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      variante: "V2R",
      casosSimilares: [],
      casiDuplicadosDescartados: 0,
    });
  });

  it("rechaza con 400 un cuerpo sin texto, una variante inventada o un texto demasiado largo", async () => {
    const app = montar(sesionCon(["ADMINISTRADOR"]));
    expect((await request(app).post(RUTA).send({})).status).toBe(400);
    expect(
      (await request(app).post(RUTA).send({ texto: TEXTO, variante: "V9" }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(RUTA)
          .send({ texto: "a".repeat(5001) })
      ).status,
    ).toBe(400);
  });

  it("no registra el texto: el análisis no escribe nada en consola", async () => {
    const espias = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
    ];
    await request(montar(sesionCon(["ADMINISTRADOR"])))
      .post(RUTA)
      .send({ texto: TEXTO });
    for (const espia of espias) expect(espia).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("IA_POC_HABILITADA", () => {
  it("apagada (por defecto) la ruta no existe: 404", async () => {
    const app = createApp(testEnv(), createFakeDatabase());
    expect((await request(app).post(RUTA).send({ texto: TEXTO })).status).toBe(
      404,
    );
  });

  it("encendida la ruta existe y pide sesión: 401", async () => {
    const app = createApp(
      testEnv({ IA_POC_HABILITADA: "true" }),
      createFakeDatabase(),
    );
    expect((await request(app).post(RUTA).send({ texto: TEXTO })).status).toBe(
      401,
    );
  });
});
