import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createLogger } from "@/config/logger.js";
import { MENSAJE_SIN_ANALISIS_DE_IA } from "@/services/analisis-incidencia/analisis-incidencia.service.js";
import { VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia as C } from "@/enums/categoria-incidencia.enum.js";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type { MetricasModelo } from "@/services/analisis-ia/analisis-ia.types.js";
import {
  ClasificadorIncidencias,
  vaciarCola,
} from "@/services/clasificador/clasificador.service.js";
import { testEnv } from "@/test-utils/env.js";
import {
  crearEstablecimientoDePrueba,
  type EstablecimientoDePrueba,
} from "@/test-utils/establecimientos.js";
import { sembrarCaso } from "@/test-utils/incidencias.js";
import {
  withRollbackDatabase,
  type RollbackContext,
} from "@/test-utils/rollback-database.js";
import { crearUsuarioDePrueba, iniciarSesion } from "@/test-utils/usuarios.js";

const url = process.env["TEST_DATABASE_URL"];

const METRICAS: MetricasModelo = {
  intentos: 1,
  duracionMs: 5,
  totalOllamaMs: 4,
  cargaModeloMs: 1,
  procesoPromptMs: 1,
  generacionMs: 2,
  tokensPrompt: 10,
  tokensSalida: 5,
};

const TEXTO_COBRO =
  "La jefa del SIS, Zulma Anaya Chacón, me pidió plata para atenderme";
const TEXTO_NEUTRO =
  "Quiero saber a qué hora abre la farmacia del hospital por las tardes";

/** Clasifica con las reglas y un modelo simulado (la categoría de la queja la pone el modelo). */
function trabajador(contexto: RollbackContext) {
  return new ClasificadorIncidencias({
    database: contexto.database,
    modelo: "modelo-de-prueba",
    analizar: (texto, ctx) =>
      analizarMensaje(texto, ctx, {
        variante: VarianteIa.V2C,
        cliente: {
          consultar: async () => ({
            ok: true,
            salida: {
              categoria: C.QUEJA,
              peso_corrupcion: 0,
              posible_corrupcion: false,
            },
            metricas: METRICAS,
          }),
        },
      }),
  });
}

function areaDe(
  roles: string[],
  eess?: EstablecimientoDePrueba,
): string | null {
  if (roles.includes(R.OTRANS)) return "OTRANS";
  if (roles.includes(R.ESTABLECIMIENTO) || roles.includes(R.GESTOR)) {
    if (!eess) throw new Error("necesita su establecimiento");
    return eess.areaCodigo;
  }
  return null;
}

describe.skipIf(!url)(
  "GET /incidencias/:codigo/analisis-ia contra PostgreSQL real",
  () => {
    const usar = (prueba: (contexto: RollbackContext) => Promise<void>) =>
      withRollbackDatabase(url as string, prueba);

    async function entrar(
      contexto: RollbackContext,
      app: ReturnType<typeof createApp>,
      roles: string[],
      eess?: EstablecimientoDePrueba,
    ) {
      const correo = await crearUsuarioDePrueba(
        contexto,
        roles,
        undefined,
        undefined,
        areaDe(roles, eess),
      );
      return iniciarSesion(app, correo);
    }

    it("OTRANS y el administrador ven el análisis de una corrupción; el establecimiento y el gestor reciben 403; sin sesión, 401", async () => {
      await usar(async (contexto) => {
        // La base de pruebas puede traer casos pendientes de antes: se clasifican primero (se revierte con la transacción).
        await vaciarCola(trabajador(contexto));
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, {
          categoria: null,
          establecimiento: eess,
          marcador: TEXTO_COBRO,
        });
        await vaciarCola(trabajador(contexto));
        const app = createApp(
          testEnv(),
          contexto.database,
          createLogger(testEnv()),
        );
        const ruta = `/incidencias/${caso.codigo}/analisis-ia`;

        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const res = await otrans.get(ruta);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          codigo: caso.codigo,
          categoriaIa: "denuncia-corrupcion",
          motivoDeEscritura: "REGLAS",
          etiquetaNormas: "Referencia orientativa; la califica OTRANS.",
          transcripcionAnexoCCotejada: false,
          requiereRevisionHumana: true,
          modelo: { variante: "V2C", degradado: false },
        });
        expect(res.body.confianzaIa).toBeLessThanOrEqual(95);
        expect(res.body.explicacion).toContain("Las reglas suman");
        expect(res.body.senales.length).toBeGreaterThan(0);
        expect(
          res.body.supuestos.map((c: { fragmentoId: string }) => c.fragmentoId),
        ).toContain("ANEXO_C-III-b");
        expect(res.body.supuestos[0].texto).toBeTruthy();
        expect(res.body.requisitosFaltantes.length).toBeGreaterThan(0);
        expect(res.body.fichaDerivacion).toMatchObject({
          codigoEntidad: "sis",
        });
        expect(res.body.cargoMencionado).toBeTruthy();
        expect(res.body.nombreMencionado).toBeTruthy();
        // El texto del ciudadano no sale en el análisis.
        expect(JSON.stringify(res.body)).not.toContain(
          "me pidió plata para atenderme relato",
        );

        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        expect((await admin.get(ruta)).status).toBe(200);

        const establecimiento = await entrar(
          contexto,
          app,
          [R.ESTABLECIMIENTO],
          eess,
        );
        expect((await establecimiento.get(ruta)).status).toBe(403);
        const gestor = await entrar(contexto, app, [R.GESTOR], eess);
        expect((await gestor.get(ruta)).status).toBe(403);
        expect((await request(app).get(ruta)).status).toBe(401);
      });
    });

    it("OTRANS solo ve el análisis de lo destinado a su área: una queja de un establecimiento le responde 404; el administrador sí la ve", async () => {
      await usar(async (contexto) => {
        await vaciarCola(trabajador(contexto));
        const eess = await crearEstablecimientoDePrueba(contexto);
        const queja = await sembrarCaso(contexto, {
          categoria: null,
          establecimiento: eess,
          marcador: TEXTO_NEUTRO,
        });
        await vaciarCola(trabajador(contexto));
        const app = createApp(
          testEnv(),
          contexto.database,
          createLogger(testEnv()),
        );
        const ruta = `/incidencias/${queja.codigo}/analisis-ia`;

        expect(
          (await (await entrar(contexto, app, [R.OTRANS])).get(ruta)).status,
        ).toBe(404);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const res = await admin.get(ruta);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          categoriaIa: "queja",
          motivoDeEscritura: "SIN_CORRUPCION",
        });
        expect(res.body.supuestos).toEqual([]);
        expect(
          res.body.procedimiento.map(
            (c: { fragmentoId: string }) => c.fragmentoId,
          ),
        ).toContain("AM-DERIVA-QUEJAS-RECLAMOS");

        // El responsable del establecimiento ve su queja en la bandeja, pero nunca el análisis ni el nombre mencionado.
        const establecimiento = await entrar(
          contexto,
          app,
          [R.ESTABLECIMIENTO],
          eess,
        );
        const detalle = await establecimiento.get(
          `/incidencias/${queja.codigo}`,
        );
        expect(detalle.status).toBe(200);
        expect(JSON.stringify(detalle.body)).not.toContain("nombreMencionado");
        expect((await establecimiento.get(ruta)).status).toBe(403);
      });
    });

    it("un caso sin análisis (todavía REGISTRADO) o con un código inexistente o mal formado responde 404", async () => {
      await usar(async (contexto) => {
        await vaciarCola(trabajador(contexto));
        const sin = await sembrarCaso(contexto, {
          categoria: null,
          marcador: TEXTO_NEUTRO,
        });
        const app = createApp(
          testEnv(),
          contexto.database,
          createLogger(testEnv()),
        );
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);

        const sinAnalisis = await admin.get(
          `/incidencias/${sin.codigo}/analisis-ia`,
        );
        expect(sinAnalisis.status).toBe(404);
        expect(JSON.stringify(sinAnalisis.body)).toContain(
          MENSAJE_SIN_ANALISIS_DE_IA,
        );
        expect(
          (await admin.get("/incidencias/MINSA-2026-999999/analisis-ia"))
            .status,
        ).toBe(404);
        expect(
          (await admin.get("/incidencias/no-es-un-codigo/analisis-ia")).status,
        ).toBe(404);
      });
    });
  },
);
