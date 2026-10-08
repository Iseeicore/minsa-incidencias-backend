import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createLogger } from "@/config/logger.js";
import type { DbExecutor } from "@/database/database.js";
import { traducirErrorDeBase } from "@/database/reglas-de-la-base.js";
import { CategoriaIncidencia as C } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { IncidenciaRepository } from "@/repositories/incidencia.repository.js";
import { testEnv } from "@/test-utils/env.js";
import { crearEstablecimientoDePrueba, type EstablecimientoDePrueba } from "@/test-utils/establecimientos.js";
import { marcaDePrueba, sembrarCaso, type OpcionesCaso } from "@/test-utils/incidencias.js";
import { withRollbackDatabase, type RollbackContext } from "@/test-utils/rollback-database.js";
import { crearUsuarioDePrueba, iniciarSesion, type AgentePrueba } from "@/test-utils/usuarios.js";

const url = process.env["TEST_DATABASE_URL"];

const construir = (contexto: RollbackContext) => createApp(testEnv(), contexto.database, createLogger(testEnv()));

interface CasoDto {
  codigo: string;
  acciones: string[];
  [clave: string]: unknown;
}

/** Quien es de OTRANS pertenece al área OTRANS; quien es de establecimiento, al área del establecimiento dado. */
function areaDe(roles: string[], eess?: EstablecimientoDePrueba): string | null {
  if (roles.includes(R.OTRANS)) return "OTRANS";
  if (roles.includes(R.ESTABLECIMIENTO)) {
    if (!eess) throw new Error("un usuario de establecimiento necesita su establecimiento");
    return eess.areaCodigo;
  }
  return null;
}

async function entrar(contexto: RollbackContext, app: ReturnType<typeof construir>, roles: string[], nombre?: string, eess?: EstablecimientoDePrueba) {
  const correo = await crearUsuarioDePrueba(contexto, roles, nombre, undefined, areaDe(roles, eess));
  const agente = await iniciarSesion(app, correo);
  return { agente, correo };
}

async function codigosVistos(agente: AgentePrueba, marcador: string): Promise<string[]> {
  const res = await agente.get("/incidencias").query({ texto: marcador, limite: "100" });
  expect(res.status).toBe(200);
  return (res.body.items as CasoDto[]).map((c) => c.codigo).sort();
}

async function accionesDe(agente: AgentePrueba, codigo: string): Promise<string[]> {
  const res = await agente.get(`/incidencias/${codigo}`);
  expect(res.status).toBe(200);
  return res.body.acciones as string[];
}

describe.skipIf(!url)("incidencias contra PostgreSQL real", () => {
  const usar = (prueba: (contexto: RollbackContext) => Promise<void>) => withRollbackDatabase(url as string, prueba);

  describe("qué ve cada rol", () => {
    it("el administrador y el gestor no filtran por área; OTRANS y cada establecimiento solo ven lo destinado a su área", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto, "Hospital A");
        const b = await crearEstablecimientoDePrueba(contexto, "Hospital B");
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: a, marcador });
        const quejaA = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a, marcador });
        const quejaB = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: b, marcador });
        const deAaB = await sembrarCaso(contexto, {
          categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", establecimiento: a, destino: b, marcador,
        });
        const sinDerivar = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: a, marcador });
        const otro = await sembrarCaso(contexto, { categoria: C.OTRO, establecimiento: a, marcador });
        const sinCategoria = await sembrarCaso(contexto, { categoria: null, establecimiento: a, marcador });
        const ordenados = (...casos: { codigo: string }[]) => casos.map((c) => c.codigo).sort();
        const todos = [corrupcion, quejaA, quejaB, deAaB, sinDerivar, otro, sinCategoria];
        const sinCorrupcion = [quejaA, quejaB, deAaB, sinDerivar, otro, sinCategoria];
        const app = construir(contexto);

        const vistos = async (roles: string[], eess?: EstablecimientoDePrueba) =>
          codigosVistos((await entrar(contexto, app, roles, undefined, eess)).agente, marcador);

        expect(await vistos([R.ADMINISTRADOR])).toEqual(ordenados(...todos));
        expect(await vistos([R.GESTOR])).toEqual(ordenados(...sinCorrupcion));
        expect(await vistos([R.OTRANS])).toEqual(ordenados(corrupcion));
        expect(await vistos([R.ESTABLECIMIENTO], a)).toEqual(ordenados(quejaA));
        expect(await vistos([R.ESTABLECIMIENTO], b)).toEqual(ordenados(quejaB, deAaB));
        expect(await vistos([R.GESTOR, R.OTRANS])).toEqual(ordenados(...todos));
        expect(await vistos([R.GESTOR, R.ESTABLECIMIENTO], a)).toEqual(ordenados(...sinCorrupcion));
      });
    });

    it("un establecimiento sin ningún caso destinado a su área ve la lista vacía", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const vacio = await crearEstablecimientoDePrueba(contexto);
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], undefined, vacio);
        expect(await codigosVistos(agente, marcador)).toEqual([]);
        expect((await agente.get("/incidencias")).body).toEqual({ items: [], siguiente: null, hayMas: false });
      });
    });

    it("quien tiene un rol de área pero ninguna área no ve nada", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a, marcador });
        const correo = await crearUsuarioDePrueba(contexto, [R.ESTABLECIMIENTO]);
        const agente = await iniciarSesion(construir(contexto), correo);
        expect(await codigosVistos(agente, marcador)).toEqual([]);
        expect((await agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
      });
    });

    it("quien no tiene rol activo recibe 403 y quien no inició sesión, 401", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const { agente } = await entrar(contexto, app, []);
        expect((await agente.get("/incidencias")).status).toBe(403);
        expect((await request(app).get("/incidencias")).status).toBe(401);
      });
    });

    it("un caso de otra área responde 404 igual que uno que no existe, y no se puede tocar", async () => {
      await usar(async (contexto) => {
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const deA = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: b });
        const app = construir(contexto);
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, b);

        const inexistente = await agente.get("/incidencias/MINSA-2099-999999");
        for (const ajeno of [deA, corrupcion]) {
          const oculto = await agente.get(`/incidencias/${ajeno.codigo}`);
          expect(oculto.status).toBe(404);
          expect(oculto.body.errorCode).toBe("NOT_FOUND");
          expect(oculto.body.message).toBe(inexistente.body.message);
          for (const accion of ["confirmar", "derivar", "tomar"]) {
            expect((await agente.post(`/incidencias/${ajeno.codigo}/${accion}`)).status).toBe(404);
          }
          expect((await agente.post(`/incidencias/${ajeno.codigo}/resolver`).send({ resolucion: "x" })).status).toBe(404);
        }
        const filas = await contexto.database.query<{ estado: string; resolucion: string | null; confirmada: boolean }>(
          `SELECT e.codigo AS estado, i.resolucion, (i.categoria_confirmada_en IS NOT NULL) AS confirmada
             FROM chatbot.incidencia_paciente i JOIN catalogo.estado_incidencia e ON e.id = i.estado_incidencia_id
            WHERE i.id = ANY($1) ORDER BY e.codigo`,
          [[deA.id, corrupcion.id]],
        );
        expect(filas).toEqual([
          { estado: "CLASIFICADO", resolucion: null, confirmada: false },
          { estado: "DERIVADO", resolucion: null, confirmada: true },
        ]);
      });
    });

    it("OTRANS tampoco abre ni toca un caso que no es de su área ni de su categoría", async () => {
      await usar(async (contexto) => {
        const a = await crearEstablecimientoDePrueba(contexto);
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a });
        const { agente } = await entrar(contexto, construir(contexto), [R.OTRANS]);
        expect((await agente.get(`/incidencias/${queja.codigo}`)).status).toBe(404);
        expect((await agente.post(`/incidencias/${queja.codigo}/tomar`)).status).toBe(404);
      });
    });

    it("una denuncia por corrupción nunca la ve un establecimiento, aunque la base quedara mal configurada", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, edadHoras: 61, establecimiento: a, marcador });
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", edadHoras: 61, establecimiento: a, marcador });
        const app = construir(contexto);
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
        const antes = (await agente.get("/incidencias/por-vencer")).body as { total: number };

        // Se apagan las reglas de la base para dejar la corrupción destinada al área del establecimiento y con la
        // categoría permitida a su rol: la vista del servidor debe seguir ocultándola.
        await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente DISABLE TRIGGER USER");
        await contexto.client.query("ALTER TABLE gestion.rol_categoria DISABLE TRIGGER USER");
        await contexto.client.query("UPDATE chatbot.incidencia_paciente SET area_destino_id = $2 WHERE id = $1", [corrupcion.id, a.areaId]);
        await contexto.client.query(
          "INSERT INTO gestion.rol_categoria (rol_id, categoria_incidencia_id) SELECT r.id, k.id FROM gestion.rol r, catalogo.categoria_incidencia k WHERE r.codigo = 'ESTABLECIMIENTO' AND k.codigo = 'DENUNCIA_CORRUPCION'",
        );
        await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente ENABLE TRIGGER USER");
        await contexto.client.query("ALTER TABLE gestion.rol_categoria ENABLE TRIGGER USER");

        expect(await codigosVistos(agente, marcador)).toEqual([queja.codigo]);
        expect((await agente.get(`/incidencias/${corrupcion.codigo}`)).status).toBe(404);
        expect((await agente.post(`/incidencias/${corrupcion.codigo}/tomar`)).status).toBe(404);
        const despues = (await agente.get("/incidencias/por-vencer")).body as { total: number; casos: CasoDto[] };
        expect(despues.total).toBe(antes.total);
        expect(despues.casos.map((c) => c.codigo)).not.toContain(corrupcion.codigo);
      });
    });
  });

  describe("contrato del detalle", () => {
    it("devuelve los campos del caso, calculados en el servidor y sin datos internos", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const revisor = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Ana Prueba");
        const eess = await crearEstablecimientoDePrueba(contexto, "Hospital Contrato");
        const caso = await sembrarCaso(contexto, {
          establecimiento: eess,
          categoria: C.RECLAMO,
          confianza: 58,
          revision: "confirmada",
          actorRevision: `usuario:${revisor}`,
          anonimo: false,
          nombre: "Luis Alberto Quispe",
          dni: "00001907",
          evidencias: 2,
          edadHoras: 20,
        });
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);

        const res = await agente.get(`/incidencias/${caso.codigo}`);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(
          [
            "acciones", "area", "categoria", "categoriaIa", "codigo", "confianzaIa", "corregida", "descripcion", "estado",
            "establecimiento", "etiquetas", "evidencias", "historial", "horasDesdeLlegada", "horasDesdeResolucion", "organismo", "plazo",
            "prioridad", "reclamante", "resolucion", "responsable", "revisadoPorHumano",
          ].sort(),
        );
        expect(res.body).toMatchObject({
          codigo: caso.codigo,
          categoria: "reclamo",
          categoriaIa: "reclamo",
          confianzaIa: 58,
          etiquetas: [],
          prioridad: null,
          organismo: null,
          area: null,
          establecimiento: { codigoRenipress: eess.codigoRenipress, nombre: eess.nombre, nivelAtencion: null, categoria: null },
          responsable: "Ana Prueba",
          estado: "clasificado",
          horasDesdeLlegada: 20,
          horasDesdeResolucion: null,
          revisadoPorHumano: true,
          corregida: false,
          resolucion: null,
          descripcion: caso.descripcion,
          reclamante: "Luis A. · DNI ••••1907",
          acciones: [],
        });
        expect(res.body.plazo).toMatchObject({ tipo: "atencion", estado: "en-plazo" });
        expect(res.body.plazo.horasRestantes).toBeGreaterThanOrEqual(51);
        expect(res.body.plazo.horasRestantes).toBeLessThanOrEqual(52);

        const texto = JSON.stringify(res.body);
        expect(texto).not.toContain(caso.traceId);
        expect(texto).not.toContain(caso.id);
        expect(texto).not.toContain("00001907");
        expect(texto).not.toContain("rutas-privadas");
        expect(texto).not.toContain("trace");
        expect(texto).not.toContain("roles");
        expect(texto).not.toContain(revisor);
        expect(Object.keys(res.body.establecimiento)).toEqual(["codigoRenipress", "nombre", "nivelAtencion", "categoria"]);
        expect(texto).not.toContain("areaId");
        expect(texto).not.toContain("wa_id");
        expect(texto).not.toContain("dni");
      });
    });

    it("el área de destino y el establecimiento de origen salen con su código y nombre, nunca con ids", async () => {
      await usar(async (contexto) => {
        const origen = await crearEstablecimientoDePrueba(contexto, "Origen");
        const destino = await crearEstablecimientoDePrueba(contexto, "Destino");
        const derivado = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: origen, destino });
        const sinOrigen = await sembrarCaso(contexto, { categoria: C.QUEJA });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: origen });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

        const a = await agente.get(`/incidencias/${derivado.codigo}`);
        expect(a.body.area).toEqual({ codigo: destino.areaCodigo, nombre: destino.areaNombre });
        expect(a.body.establecimiento).toEqual({ codigoRenipress: origen.codigoRenipress, nombre: origen.nombre, nivelAtencion: null, categoria: null });
        expect(Object.keys(a.body.area)).toEqual(["codigo", "nombre"]);

        const b = await agente.get(`/incidencias/${sinOrigen.codigo}`);
        expect(b.body).toMatchObject({ area: null, establecimiento: null });

        const c = await agente.get(`/incidencias/${corrupcion.codigo}`);
        expect(c.body.area).toEqual({ codigo: "OTRANS", nombre: "OTRANS" });
        expect(c.body.establecimiento).toEqual({ codigoRenipress: origen.codigoRenipress, nombre: origen.nombre, nivelAtencion: null, categoria: null });
      });
    });

    it("las evidencias salen solo con sus metadatos y marcan como sensibles las de corrupción", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, evidencias: 2 });
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, evidencias: 1 });
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);

        const a = await agente.get(`/incidencias/${corrupcion.codigo}`);
        expect(a.body.evidencias).toHaveLength(2);
        for (const evidencia of a.body.evidencias) {
          expect(Object.keys(evidencia).sort()).toEqual(["fecha", "nombre", "sensible", "tipo", "verificada"]);
          expect(evidencia).toMatchObject({ tipo: "imagen", sensible: true, verificada: false });
        }
        const b = await agente.get(`/incidencias/${queja.codigo}`);
        expect(b.body.evidencias).toHaveLength(1);
        expect(b.body.evidencias[0]).toMatchObject({ nombre: "foto-1.jpg", sensible: false });
      });
    });

    it("un reporte anónimo no muestra a la persona y un caso archivado no tiene plazo ni acciones", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const anonimo = await sembrarCaso(contexto, { categoria: C.QUEJA, anonimo: true });
        const archivado = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "ARCHIVADO" });
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);

        expect((await agente.get(`/incidencias/${anonimo.codigo}`)).body.reclamante).toBe("Anónimo");
        const res = await agente.get(`/incidencias/${archivado.codigo}`);
        expect(res.body).toMatchObject({
          estado: "archivado",
          acciones: [],
          plazo: { tipo: null, estado: null, venceEn: null, horasRestantes: null },
          resolucion: "Resuelto en la prueba.",
        });
      });
    });

    it("el plazo de atención por vencer se calcula con los días y las horas de aviso configurados", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 60 });
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const res = await agente.get(`/incidencias/${caso.codigo}`);
        expect(res.body.plazo).toMatchObject({ tipo: "atencion", estado: "por-vencer" });
        expect(res.body.plazo.horasRestantes).toBeGreaterThanOrEqual(11);
        expect(res.body.plazo.horasRestantes).toBeLessThanOrEqual(12);
        expect(res.body.horasDesdeLlegada).toBeGreaterThanOrEqual(60);
      });
    });

    it("un caso resuelto tiene la vigencia de su resolución", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "RESUELTO", edadHoras: 100, resueltoHaceHoras: 10 });
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const res = await agente.get(`/incidencias/${caso.codigo}`);
        expect(res.body.plazo).toMatchObject({ tipo: "vigencia", estado: "en-plazo" });
        expect(res.body.plazo.horasRestantes).toBeGreaterThanOrEqual(61);
        expect(res.body.plazo.horasRestantes).toBeLessThanOrEqual(62);
        expect(res.body.horasDesdeResolucion).toBeGreaterThanOrEqual(10);
        expect(res.body.horasDesdeResolucion).toBeLessThanOrEqual(11);
      });
    });
  });

  describe("acciones permitidas calculadas en el servidor", () => {
    const filas: [string, string[], OpcionesCaso, string[]][] = [
      ["gestor, queja clasificada sin revisar", [R.GESTOR], { categoria: C.QUEJA }, ["confirmar", "corregir"]],
      ["gestor, queja revisada", [R.GESTOR], { categoria: C.QUEJA, revision: "confirmada" }, ["derivar"]],
      ["gestor, reclamo revisado", [R.GESTOR], { categoria: C.RECLAMO, revision: "confirmada" }, ["derivar"]],
      ["gestor, caso otro revisado (solo quejas y reclamos se derivan)", [R.GESTOR], { categoria: C.OTRO, revision: "confirmada" }, []],
      ["gestor, queja ya derivada", [R.GESTOR], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, []],
      ["administrador nunca actúa", [R.ADMINISTRADOR], { categoria: C.QUEJA }, []],
      ["OTRANS, sin revisar", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION }, ["confirmar", "corregir"]],
      ["OTRANS, revisada: toma directo", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada" }, ["tomar"]],
      ["OTRANS, derivada", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["OTRANS, en gestión", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", estado: "EN_GESTION" }, ["resolver"]],
      ["establecimiento, queja derivada", [R.ESTABLECIMIENTO], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["establecimiento, reclamo derivado", [R.ESTABLECIMIENTO], { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["establecimiento, queja en gestión", [R.ESTABLECIMIENTO], { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION" }, ["resolver"]],
      ["establecimiento, queja resuelta", [R.ESTABLECIMIENTO], { categoria: C.QUEJA, revision: "confirmada", estado: "RESUELTO" }, []],
      ["gestor y establecimiento, queja derivada", [R.GESTOR, R.ESTABLECIMIENTO], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["gestor y OTRANS, corrupción revisada", [R.GESTOR, R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada" }, ["tomar"]],
    ];

    it.each(filas)("%s", async (_nombre, roles, opciones, esperadas) => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { ...opciones, establecimiento: eess });
        const { agente } = await entrar(contexto, construir(contexto), roles, undefined, eess);
        expect(await accionesDe(agente, caso.codigo)).toEqual(esperadas);
        const lista = await agente.get("/incidencias").query({ texto: caso.codigo });
        expect(lista.body.items).toHaveLength(1);
        expect(lista.body.items[0].acciones).toEqual(esperadas);
      });
    });
  });

  describe("lista: paginación por cursor y filtros", () => {
    it("20 por página del más reciente al más antiguo, con cursor y sin total", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const casos = [];
        for (let n = 0; n < 25; n += 1) {
          casos.push(await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, edadHoras: 10 + n }));
        }
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const recientesPrimero = casos.map((c) => c.codigo);
        const codigos = (cuerpo: { items: CasoDto[] }) => cuerpo.items.map((c) => c.codigo);

        const primera = await agente.get("/incidencias").query({ texto: marcador });
        expect(primera.status).toBe(200);
        expect(Object.keys(primera.body).sort()).toEqual(["hayMas", "items", "siguiente"]);
        expect(primera.body.hayMas).toBe(true);
        expect(typeof primera.body.siguiente).toBe("string");
        expect(codigos(primera.body)).toEqual(recientesPrimero.slice(0, 20));

        const segunda = await agente.get("/incidencias").query({ texto: marcador, cursor: primera.body.siguiente });
        expect(codigos(segunda.body)).toEqual(recientesPrimero.slice(20));
        expect(segunda.body).toMatchObject({ siguiente: null, hayMas: false });
      });
    });

    it("recorre todo con cualquier límite sin repetir ni saltar casos, y el último trae siguiente null", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const casos = [];
        for (let n = 0; n < 12; n += 1) casos.push(await sembrarCaso(contexto, { categoria: C.RECLAMO, marcador, edadHoras: 10 + n }));
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const esperado = casos.map((c) => c.codigo);

        for (const limite of [1, 5, 11, 12, 13, 100]) {
          const vistos: string[] = [];
          let cursor: string | undefined;
          let paginas = 0;
          do {
            const res = await agente.get("/incidencias").query({ texto: marcador, limite: String(limite), ...(cursor ? { cursor } : {}) });
            expect(res.status).toBe(200);
            expect(res.body.items.length).toBeLessThanOrEqual(limite);
            vistos.push(...(res.body.items as CasoDto[]).map((c) => c.codigo));
            expect(res.body.hayMas).toBe(res.body.siguiente !== null);
            cursor = res.body.siguiente ?? undefined;
            paginas += 1;
          } while (cursor);
          expect(vistos).toEqual(esperado);
          expect(paginas).toBe(Math.ceil(12 / limite));
        }
      });
    });

    it("con el límite exacto no hay más páginas, y sin casos la lista viene vacía", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        for (let n = 0; n < 3; n += 1) await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, edadHoras: 5 + n });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const exacto = await agente.get("/incidencias").query({ texto: marcador, limite: "3" });
        expect(exacto.body).toMatchObject({ hayMas: false, siguiente: null });
        expect(exacto.body.items).toHaveLength(3);
        expect((await agente.get("/incidencias").query({ texto: `${marcador}-no-existe` })).body).toEqual({ items: [], siguiente: null, hayMas: false });
      });
    });

    it("es estable: casos con la misma fecha se desempatan por id y un caso nuevo no mueve las páginas ya pedidas", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const iguales = [];
        for (let n = 0; n < 7; n += 1) iguales.push(await sembrarCaso(contexto, { categoria: C.QUEJA, marcador }));
        await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente DISABLE TRIGGER USER");
        await contexto.client.query("UPDATE chatbot.incidencia_paciente SET fecha_creacion = now() - interval '2 days' WHERE id = ANY($1)", [
          iguales.map((c) => c.id),
        ]);
        await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente ENABLE TRIGGER USER");
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const enOrden = await contexto.database.query<{ codigo: string }>(
          "SELECT codigo FROM chatbot.incidencia_paciente WHERE id = ANY($1) ORDER BY fecha_creacion DESC, id DESC",
          [iguales.map((c) => c.id)],
        );

        const primera = await agente.get("/incidencias").query({ texto: marcador, limite: "3" });
        const nuevo = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const segunda = await agente.get("/incidencias").query({ texto: marcador, limite: "3", cursor: primera.body.siguiente });
        const tercera = await agente.get("/incidencias").query({ texto: marcador, limite: "3", cursor: segunda.body.siguiente });
        const vistos = [primera, segunda, tercera].flatMap((res) => (res.body.items as CasoDto[]).map((c) => c.codigo));
        expect(vistos).toEqual(enOrden.map((f) => f.codigo));
        expect(tercera.body).toMatchObject({ hayMas: false, siguiente: null });

        const desdeCero = await agente.get("/incidencias").query({ texto: marcador, limite: "1" });
        expect((desdeCero.body.items as CasoDto[])[0]?.codigo).toBe(nuevo.codigo);
      });
    });

    it("el cursor respeta los filtros y la visibilidad de quien lo usa", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const deA = [];
        for (let n = 0; n < 4; n += 1) {
          deA.push(await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a, marcador, edadHoras: 10 + n }));
        }
        const deB = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: b, marcador, edadHoras: 3 });
        const app = construir(contexto);
        const usuarioA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);

        const primera = await usuarioA.agente.get("/incidencias").query({ texto: marcador, limite: "3", estado: "derivado" });
        const segunda = await usuarioA.agente.get("/incidencias").query({ texto: marcador, limite: "3", estado: "derivado", cursor: primera.body.siguiente });
        const vistos = [primera, segunda].flatMap((res) => (res.body.items as CasoDto[]).map((c) => c.codigo));
        expect(vistos).toEqual(deA.map((c) => c.codigo));
        expect(vistos).not.toContain(deB.codigo);
      });
    });

    it("un cursor inválido responde 400 y no llega a la base", async () => {
      await usar(async (contexto) => {
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        for (const cursor of ["basura", "MjAyNi0xMC0wNXxubw", Buffer.from("2026-10-05T00:00:00.000Z|1' OR '1'='1").toString("base64url")]) {
          const res = await agente.get("/incidencias").query({ cursor });
          expect(res.status).toBe(400);
          expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        }
      });
    });

    it("filtra por estado, por categoría, por casos sin categoría y por texto", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const eess = await crearEstablecimientoDePrueba(contexto);
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const derivado = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", marcador, establecimiento: eess });
        const sin = await sembrarCaso(contexto, { categoria: null, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const ver = async (filtros: Record<string, string>) =>
          ((await agente.get("/incidencias").query({ texto: marcador, ...filtros })).body.items as CasoDto[]).map((x) => x.codigo).sort();

        expect(await ver({ estado: "derivado" })).toEqual([derivado.codigo]);
        expect(await ver({ estado: "registrado" })).toEqual([sin.codigo]);
        expect(await ver({ categoria: "queja" })).toEqual([queja.codigo]);
        expect(await ver({ categoria: "sin-categoria" })).toEqual([sin.codigo]);
        expect(await ver({ categoria: "reclamo", estado: "derivado" })).toEqual([derivado.codigo]);
        expect(await ver({ categoria: "queja", estado: "derivado" })).toEqual([]);

        const porCodigo = await agente.get("/incidencias").query({ texto: queja.codigo });
        expect((porCodigo.body.items as CasoDto[]).map((x) => x.codigo)).toEqual([queja.codigo]);
        const porCodigoParcial = await agente.get("/incidencias").query({ texto: queja.codigo.toLowerCase().slice(6) });
        expect((porCodigoParcial.body.items as CasoDto[]).map((x) => x.codigo)).toContain(queja.codigo);
      });
    });

    it("el texto se busca literal: % y _ no son comodines y las comillas no rompen la consulta", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const total = async (texto: string) => ((await agente.get("/incidencias").query({ texto })).body.items as CasoDto[]).length;

        expect(await total(marcador)).toBe(1);
        expect(await total(`${marcador}%`)).toBe(0);
        expect(await total(`_${marcador.slice(1)}`)).toBe(0);
        expect(await total("'; DROP TABLE chatbot.incidencia_paciente; --")).toBe(0);
        expect(await total(marcador)).toBe(1);
      });
    });

    it("solo lista los casos que el rol ve", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, marcador });
        await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR]);
        const res = await agente.get("/incidencias").query({ texto: marcador });
        expect(res.body.items).toHaveLength(1);
        expect(res.body.hayMas).toBe(false);
      });
    });

    it("el establecimiento de origen trae nivel de atención y categoría, en la lista y en el detalle", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const eess = await crearEstablecimientoDePrueba(contexto);
        await contexto.database.transaction("sistema:prueba", (tx) =>
          tx.query(
            "UPDATE catalogo.establecimiento_salud SET categoria = 'I-3', nivel_atencion_id = (SELECT id FROM catalogo.nivel_atencion WHERE codigo = 'I') WHERE id = $1",
            [eess.establecimientoId],
          ),
        );
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const esperado = { codigoRenipress: eess.codigoRenipress, nombre: eess.nombre, nivelAtencion: "I", categoria: "I-3" };

        const lista = await agente.get("/incidencias").query({ texto: marcador });
        expect((lista.body.items as { establecimiento: unknown }[])[0]?.establecimiento).toEqual(esperado);
        expect((await agente.get(`/incidencias/${caso.codigo}`)).body.establecimiento).toEqual(esperado);
      });
    });

    describe("filtro por establecimiento de origen", () => {
      it("filtra por el código RENIPRESS, acepta ceros a la izquierda y un código sin casos o inexistente da lista vacía", async () => {
        await usar(async (contexto) => {
          const marcador = marcaDePrueba();
          const a = await crearEstablecimientoDePrueba(contexto);
          const b = await crearEstablecimientoDePrueba(contexto);
          const vacio = await crearEstablecimientoDePrueba(contexto);
          const deA = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: a, marcador });
          const deB = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: b, marcador });
          const sinOrigen = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
          const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
          const ver = async (establecimiento: string) => {
            const res = await agente.get("/incidencias").query({ texto: marcador, establecimiento });
            expect(res.status).toBe(200);
            return (res.body.items as CasoDto[]).map((c) => c.codigo);
          };

          expect(await ver(a.codigoRenipress)).toEqual([deA.codigo]);
          expect(await ver(`000${b.codigoRenipress}`)).toEqual([deB.codigo]);
          expect(await ver(vacio.codigoRenipress)).toEqual([]);
          expect(await ver("12345678")).toEqual([]);
          expect(sinOrigen.codigo).toBeDefined();
        });
      });

      it("nunca amplía la visibilidad: un establecimiento solo ve lo destinado a su área aunque filtre por otro origen", async () => {
        await usar(async (contexto) => {
          const marcador = marcaDePrueba();
          const a = await crearEstablecimientoDePrueba(contexto);
          const b = await crearEstablecimientoDePrueba(contexto);
          const origenAdestinoB = await sembrarCaso(contexto, {
            categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", establecimiento: a, destino: b, marcador,
          });
          const origenAdestinoA = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a, marcador });
          const app = construir(contexto);
          const delA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
          const delB = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, b);
          const gestor = await entrar(contexto, app, [R.GESTOR]);
          const ver = async (agente: AgentePrueba, establecimiento: string) =>
            ((await agente.get("/incidencias").query({ texto: marcador, establecimiento })).body.items as CasoDto[]).map((c) => c.codigo).sort();

          expect(await ver(delA.agente, a.codigoRenipress)).toEqual([origenAdestinoA.codigo]);
          expect(await ver(delA.agente, b.codigoRenipress)).toEqual([]);
          expect(await ver(delB.agente, a.codigoRenipress)).toEqual([origenAdestinoB.codigo]);
          expect(await ver(gestor.agente, a.codigoRenipress)).toEqual([origenAdestinoA.codigo, origenAdestinoB.codigo].sort());
        });
      });

      it("se combina con otros filtros y con el cursor: recorre todo sin repetir ni saltar", async () => {
        await usar(async (contexto) => {
          const marcador = marcaDePrueba();
          const a = await crearEstablecimientoDePrueba(contexto);
          const b = await crearEstablecimientoDePrueba(contexto);
          const deA = [];
          for (let n = 0; n < 5; n += 1) deA.push(await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: a, marcador, edadHoras: 10 + n }));
          const reclamoA = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: a, marcador, edadHoras: 3 });
          await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: b, marcador, edadHoras: 1 });
          const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

          const vistos: string[] = [];
          let cursor: string | undefined;
          do {
            const res = await agente
              .get("/incidencias")
              .query({ texto: marcador, establecimiento: a.codigoRenipress, limite: "2", ...(cursor ? { cursor } : {}) });
            expect(res.status).toBe(200);
            vistos.push(...(res.body.items as CasoDto[]).map((c) => c.codigo));
            cursor = res.body.siguiente ?? undefined;
          } while (cursor);
          expect(vistos).toEqual([reclamoA, ...deA].map((c) => c.codigo));

          const soloQuejas = await agente.get("/incidencias").query({ texto: marcador, establecimiento: a.codigoRenipress, categoria: "queja", limite: "100" });
          expect((soloQuejas.body.items as CasoDto[]).map((c) => c.codigo)).toEqual(deA.map((c) => c.codigo));
        });
      });

      it("un código con formato inválido responde 400", async () => {
        await usar(async (contexto) => {
          const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
          for (const establecimiento of ["abc", "0", "000", "123456789", "12 34", "1'; DROP TABLE x", "-5"]) {
            const res = await agente.get("/incidencias").query({ establecimiento });
            expect(res.status).toBe(400);
            expect(res.body.errorCode).toBe("VALIDATION_FAILED");
          }
        });
      });
    });
  });

  describe("acciones", () => {
    it("confirmar: la base firma al usuario, el caso queda revisado y se copia al entrenamiento", async () => {
      await usar(async (contexto) => {
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA });
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.GESTOR], "Gina Gestora");

        const res = await agente.post(`/incidencias/${caso.codigo}/confirmar`);
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Categoría confirmada. Se guardó para mejorar la IA.");
        expect(res.body.caso).toMatchObject({ codigo: caso.codigo, revisadoPorHumano: true, corregida: false, acciones: ["derivar"], responsable: "Gina Gestora" });

        const [fila] = await contexto.database.query<{ por: string; fue_corregida: boolean; revisado_por: string }>(
          `SELECT i.categoria_confirmada_por AS por, t.fue_corregida, t.revisado_por
             FROM chatbot.incidencia_paciente i JOIN ia.entrenamiento_categoria t ON t.incidencia_paciente_id = i.id
            WHERE i.id = $1`,
          [caso.id],
        );
        expect(fila).toEqual({ por: `usuario:${correo}`, fue_corregida: false, revisado_por: `usuario:${correo}` });

        expect((await agente.post(`/incidencias/${caso.codigo}/confirmar`)).status).toBe(403);
        expect((await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "reclamo" })).status).toBe(403);
      });
    });

    it("corregir: cambia la categoría y el área, queda como corregida y se copia al entrenamiento", async () => {
      await usar(async (contexto) => {
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO });
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.GESTOR]);

        const res = await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "queja" });
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Categoría corregida. Se guardó para mejorar la IA.");
        expect(res.body.caso).toMatchObject({ categoria: "queja", categoriaIa: "reclamo", corregida: true, revisadoPorHumano: true, area: null, acciones: ["derivar"] });

        const [fila] = await contexto.database.query<{ fue_corregida: boolean; categoria_final: string; revisado_por: string }>(
          `SELECT t.fue_corregida, c.codigo AS categoria_final, t.revisado_por
             FROM ia.entrenamiento_categoria t JOIN catalogo.categoria_incidencia c ON c.id = t.categoria_final_id
            WHERE t.incidencia_paciente_id = $1`,
          [caso.id],
        );
        expect(fila).toEqual({ fue_corregida: true, categoria_final: "QUEJA", revisado_por: `usuario:${correo}` });

        expect((await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "otro" })).status).toBe(403);
      });
    });

    it("corregir a la misma categoría responde 422 y no registra nada", async () => {
      await usar(async (contexto) => {
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR]);
        const res = await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "reclamo" });
        expect(res.status).toBe(422);
        expect(res.body.errorCode).toBe("UNPROCESSABLE");
        expect((await accionesDe(agente, caso.codigo))).toEqual(["confirmar", "corregir"]);
      });
    });

    it("el gestor corrige a corrupción: el caso sale de su vista y la respuesta lo avisa", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO });
        const { agente } = await entrar(contexto, app, [R.GESTOR]);

        const res = await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "denuncia-corrupcion" });
        expect(res.status).toBe(200);
        expect(res.body.caso).toBeNull();
        expect(res.body.mensaje).toContain("Denuncia por corrupción");
        expect(res.body.mensaje).toContain("ya no aparece");
        expect((await agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);

        const [fila] = await contexto.database.query<{ area: string }>(
          "SELECT a.codigo AS area FROM chatbot.incidencia_paciente i JOIN catalogo.area a ON a.id = i.area_destino_id WHERE i.id = $1",
          [caso.id],
        );
        expect(fila?.area).toBe("OTRANS");
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        expect(await accionesDe(otrans.agente, caso.codigo)).toEqual(["tomar"]);
      });
    });

    it("OTRANS corrige a queja: sale de su vista y el gestor, que ahora la ve, la deriva al establecimiento de origen", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess });
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const gestor = await entrar(contexto, app, [R.GESTOR]);

        expect((await otrans.agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "queja" })).body.caso).toBeNull();
        expect((await otrans.agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
        expect(await accionesDe(gestor.agente, caso.codigo)).toEqual(["derivar"]);

        const res = await gestor.agente.post(`/incidencias/${caso.codigo}/derivar`);
        expect(res.status).toBe(200);
        expect(res.body.caso.area).toEqual({ codigo: eess.areaCodigo, nombre: eess.areaNombre });
      });
    });

    it("derivar: va por defecto al área del establecimiento de origen y la base firma la derivación", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: eess });
        const { agente, correo } = await entrar(contexto, app, [R.GESTOR], "Gina Gestora");
        const res = await agente.post(`/incidencias/${caso.codigo}/derivar`);
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Caso derivado al área.");
        expect(res.body.caso).toMatchObject({
          estado: "derivado",
          responsable: "Gina Gestora",
          acciones: [],
          area: { codigo: eess.areaCodigo, nombre: eess.areaNombre },
        });

        const [fila] = await contexto.database.query<{ area_destino_id: number; derivado_por: string; derivado_en: Date | null }>(
          "SELECT area_destino_id, derivado_por, derivado_en FROM chatbot.incidencia_paciente WHERE id = $1",
          [caso.id],
        );
        expect(fila).toMatchObject({ area_destino_id: eess.areaId, derivado_por: `usuario:${correo}` });
        expect(fila?.derivado_en).toBeInstanceOf(Date);

        const delArea = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        expect(await accionesDe(delArea.agente, caso.codigo)).toEqual(["tomar", "resolver"]);
      });
    });

    it("derivar con areaDestino lo envía a ese establecimiento aunque el origen sea otro, y el de origen deja de verlo", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const origen = await crearEstablecimientoDePrueba(contexto);
        const destino = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", establecimiento: origen });
        const gestor = await entrar(contexto, app, [R.GESTOR]);

        const res = await gestor.agente.post(`/incidencias/${caso.codigo}/derivar`).send({ areaDestino: destino.areaCodigo });
        expect(res.status).toBe(200);
        expect(res.body.caso.area).toEqual({ codigo: destino.areaCodigo, nombre: destino.areaNombre });
        expect(res.body.caso.establecimiento).toEqual({ codigoRenipress: origen.codigoRenipress, nombre: origen.nombre, nivelAtencion: null, categoria: null });

        expect((await (await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, destino)).agente.get(`/incidencias/${caso.codigo}`)).status).toBe(200);
        expect((await (await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, origen)).agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
      });
    });

    it("derivar un caso sin establecimiento de origen y sin areaDestino responde 422 y deja el caso como estaba", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada" });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR]);

        const sinDestino = await agente.post(`/incidencias/${caso.codigo}/derivar`);
        expect(sinDestino.status).toBe(422);
        expect(sinDestino.body.errorCode).toBe("UNPROCESSABLE");
        expect(sinDestino.body.message).toContain("área de destino");
        expect((await agente.get(`/incidencias/${caso.codigo}`)).body.estado).toBe("clasificado");

        const conDestino = await agente.post(`/incidencias/${caso.codigo}/derivar`).send({ areaDestino: eess.areaCodigo });
        expect(conDestino.status).toBe(200);
        expect(conDestino.body.caso.estado).toBe("derivado");
      });
    });

    it("derivar solo acepta un área activa de tipo establecimiento: otra, desactivada o inexistente responde 422", async () => {
      await usar(async (contexto) => {
        const origen = await crearEstablecimientoDePrueba(contexto);
        const desactivada = await crearEstablecimientoDePrueba(contexto);
        await contexto.database.transaction("sistema:prueba", async (tx) => {
          await tx.query("UPDATE catalogo.area SET activo = false WHERE id = $1", [desactivada.areaId]);
          await tx.query(
            "INSERT INTO catalogo.area (codigo, nombre, tipo_area_id) SELECT 'DIRIS-PRUEBA', 'DIRIS de prueba', id FROM catalogo.tipo_area WHERE codigo = 'DIRIS'",
          );
        });
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: origen });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR]);

        for (const areaDestino of ["OTRANS", "DIRIS-PRUEBA", desactivada.areaCodigo, "EESS-NO-EXISTE"]) {
          const res = await agente.post(`/incidencias/${caso.codigo}/derivar`).send({ areaDestino });
          expect(res.status).toBe(422);
          expect(res.body.errorCode).toBe("UNPROCESSABLE");
        }
        expect((await agente.post(`/incidencias/${caso.codigo}/derivar`).send({ areaDestino: "" })).status).toBe(400);
        expect((await agente.get(`/incidencias/${caso.codigo}`)).body.estado).toBe("clasificado");
      });
    });

    it("derivar un caso cuyo establecimiento de origen tiene el área desactivada responde 422", async () => {
      await usar(async (contexto) => {
        const origen = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: origen });
        await contexto.database.transaction("sistema:prueba", (tx) =>
          tx.query("UPDATE catalogo.area SET activo = false WHERE id = $1", [origen.areaId]),
        );
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR]);
        const res = await agente.post(`/incidencias/${caso.codigo}/derivar`);
        expect(res.status).toBe(422);
      });
    });

    it("derivar sin revisión, un caso otro o por un rol que no deriva responde 403", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const sinRevisar = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess });
        const otro = await sembrarCaso(contexto, { categoria: C.OTRO, revision: "confirmada", establecimiento: eess });
        const yaDerivada = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: eess });
        const gestor = await entrar(contexto, app, [R.GESTOR]);
        const area = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);

        const sinRevisarRes = await gestor.agente.post(`/incidencias/${sinRevisar.codigo}/derivar`);
        expect(sinRevisarRes.status).toBe(403);
        expect(sinRevisarRes.body.errorCode).toBe("FORBIDDEN");
        expect((await gestor.agente.post(`/incidencias/${otro.codigo}/derivar`)).status).toBe(403);
        expect((await area.agente.post(`/incidencias/${yaDerivada.codigo}/derivar`)).status).toBe(403);
      });
    });

    it("el gestor no puede derivar una denuncia por corrupción a un establecimiento: ni la ve (404)", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", establecimiento: eess });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR]);
        const res = await agente.post(`/incidencias/${corrupcion.codigo}/derivar`).send({ areaDestino: eess.areaCodigo });
        expect(res.status).toBe(404);
      });
    });

    it("tomar: el establecimiento toma lo derivado a su área; otro establecimiento no lo ve; OTRANS toma directo desde clasificado", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", establecimiento: a });
        const delA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
        const delB = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, b);
        const otrans = await entrar(contexto, app, [R.OTRANS]);

        expect((await delB.agente.post(`/incidencias/${queja.codigo}/tomar`)).status).toBe(404);
        expect((await delA.agente.post(`/incidencias/${corrupcion.codigo}/tomar`)).status).toBe(404);
        const tomada = await delA.agente.post(`/incidencias/${queja.codigo}/tomar`);
        expect(tomada.status).toBe(200);
        expect(tomada.body.mensaje).toBe("Caso tomado en gestión.");
        expect(tomada.body.caso).toMatchObject({ estado: "en-gestion", acciones: ["resolver"] });

        const [marca] = await contexto.database.query<{ tomado_por: string | null; tomado_en: Date | null }>(
          "SELECT tomado_por, tomado_en FROM chatbot.incidencia_paciente WHERE id = $1",
          [queja.id],
        );
        expect(marca?.tomado_por).toMatch(/^usuario:/);
        expect(marca?.tomado_en).toBeInstanceOf(Date);

        const directa = await otrans.agente.post(`/incidencias/${corrupcion.codigo}/tomar`);
        expect(directa.status).toBe(200);
        expect(directa.body.caso).toMatchObject({ estado: "en-gestion", categoria: "denuncia-corrupcion" });
        const [fila] = await contexto.database.query<{ estado: string }>(
          "SELECT e.codigo AS estado FROM chatbot.incidencia_paciente i JOIN catalogo.estado_incidencia e ON e.id = i.estado_incidencia_id WHERE i.id = $1",
          [corrupcion.id],
        );
        expect(fila?.estado).toBe("EN_GESTION");
      });
    });

    it("resolver: exige el texto, la base pone RESUELTO y la resolución se registra una sola vez", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION", establecimiento: eess });
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], undefined, eess);

        expect((await agente.post(`/incidencias/${caso.codigo}/resolver`).send({ resolucion: "  " })).status).toBe(400);
        expect((await agente.post(`/incidencias/${caso.codigo}/resolver`).send({})).status).toBe(400);

        const res = await agente.post(`/incidencias/${caso.codigo}/resolver`).send({ resolucion: "Se corrigió el horario." });
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Caso resuelto.");
        expect(res.body.caso).toMatchObject({ estado: "resuelto", resolucion: "Se corrigió el horario.", horasDesdeResolucion: 0, acciones: [] });
        expect(res.body.caso.plazo).toMatchObject({ tipo: "vigencia", estado: "en-plazo" });

        const [fila] = await contexto.database.query<{ resuelto_por: string }>(
          "SELECT resuelto_por FROM chatbot.incidencia_paciente WHERE id = $1",
          [caso.id],
        );
        expect(fila?.resuelto_por).toBe(`usuario:${correo}`);
        expect((await agente.post(`/incidencias/${caso.codigo}/resolver`).send({ resolucion: "Otra." })).status).toBe(403);
      });
    });

    it("el administrador no puede ejecutar ninguna acción", async () => {
      await usar(async (contexto) => {
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        for (const accion of ["confirmar", "derivar", "tomar"]) {
          expect((await agente.post(`/incidencias/${caso.codigo}/${accion}`)).status).toBe(403);
        }
        expect((await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "otro" })).status).toBe(403);
        expect((await agente.post(`/incidencias/${caso.codigo}/resolver`).send({ resolucion: "x" })).status).toBe(403);
      });
    });

    it("las reglas de áreas y de archivo de la base se traducen a un error claro, no a un 500", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: eess });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess });
        const repositorio = new IncidenciaRepository(contexto.database);
        const traducido = (trabajo: (tx: DbExecutor) => Promise<unknown>) =>
          contexto.database.transaction("usuario:prueba@minsa.gob.pe", trabajo).catch((e: unknown) => traducirErrorDeBase(e));

        // Derivar exige un área de destino.
        expect(await traducido((tx) => repositorio.cambiarEstado(tx, queja.id, EstadoIncidencia.DERIVADO))).toMatchObject({
          statusCode: 422,
          message: "El caso necesita un área de destino para derivarlo o tomarlo.",
        });
        // Una denuncia por corrupción no se deriva a un establecimiento.
        expect(await traducido((tx) => repositorio.derivar(tx, corrupcion.id, eess.areaId))).toMatchObject({
          statusCode: 422,
          message: expect.stringContaining("solo se deriva a la oficina de transparencia"),
        });
        // El establecimiento de origen no cambia.
        const otro = await crearEstablecimientoDePrueba(contexto);
        expect(
          await traducido((tx) =>
            tx.query("UPDATE chatbot.incidencia_paciente SET establecimiento_id = $2 WHERE id = $1", [queja.id, otro.establecimientoId]),
          ),
        ).toMatchObject({ statusCode: 409, message: "El establecimiento de origen del caso no se puede cambiar." });
        // Un caso abierto no se archiva a mano.
        expect(
          await traducido((tx) =>
            tx.query(
              "UPDATE chatbot.incidencia_paciente SET estado_incidencia_id = 7, motivo_archivo_id = (SELECT id FROM catalogo.motivo_archivo WHERE codigo = 'VENCIDA_SIN_ATENDER') WHERE id = $1",
              [queja.id],
            ),
          ),
        ).toMatchObject({ statusCode: 409, message: "Un caso abierto solo se archiva cuando vence su plazo de atención." });
      });
    });

    it("si la base rechaza el cambio por una carrera, el repositorio lo traduce a un 409 claro", async () => {
      await usar(async (contexto) => {
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "corregida", corregidaA: C.QUEJA });
        const repositorio = new IncidenciaRepository(contexto.database);

        const error = await contexto.database
          .transaction("usuario:prueba@minsa.gob.pe", (tx) => repositorio.corregir(tx, caso.id, C.OTRO))
          .catch((e: unknown) => traducirErrorDeBase(e));
        expect(error).toMatchObject({ statusCode: 409, errorCode: "CONFLICT", message: "La categoría ya se corrigió una vez." });
      });
    });
  });

  describe("historial y responsable", () => {
    it("cuenta los hitos del caso con quién los hizo, sin copiar el contenido ni los correos", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const marcador = marcaDePrueba();
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, confianza: 77, establecimiento: eess });
        const gestor = await entrar(contexto, app, [R.GESTOR], "Gina Gestora");
        await gestor.agente.post(`/incidencias/${caso.codigo}/confirmar`);
        await gestor.agente.post(`/incidencias/${caso.codigo}/derivar`);
        const area = await entrar(contexto, app, [R.ESTABLECIMIENTO], "Aldo Área", eess);
        await area.agente.post(`/incidencias/${caso.codigo}/tomar`);

        const res = await area.agente.get(`/incidencias/${caso.codigo}`);
        const historial = res.body.historial as { titulo: string; detalle?: string; hora: string; fecha: string }[];
        expect(historial.map((h) => h.titulo)).toEqual([
          "Recibido por WhatsApp",
          "La IA clasificó el caso",
          "Categoría confirmada",
          "Derivado al área",
          "Tomado en gestión",
        ]);
        expect(historial[1]?.detalle).toBe("Queja con 77 % de confianza (clasificador v-prueba).");
        expect(historial[2]?.detalle).toBe("Por Gina Gestora.");
        expect(historial[4]?.detalle).toBe("Por Aldo Área.");
        expect(res.body.responsable).toBe("Gina Gestora");
        for (const item of historial) {
          expect(item.hora).toMatch(/^hace /);
          expect(new Date(item.fecha).toString()).not.toBe("Invalid Date");
        }
        const texto = JSON.stringify(historial);
        expect(texto).not.toContain(marcador);
        expect(texto).not.toContain("usuario:");
        expect(texto).not.toContain("@minsa.gob.pe");
      });
    });

    it("el responsable es quien derivó, o si no quien corrigió, o si no quien confirmó; sin persona, ninguno", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const ana = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Ana Corrige");
        const beto = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Beto Deriva");
        const corregido = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "corregida", corregidaA: C.QUEJA, actorRevision: `usuario:${ana}` });
        const derivado = await sembrarCaso(contexto, {
          categoria: C.RECLAMO, revision: "corregida", corregidaA: C.QUEJA, actorRevision: `usuario:${ana}`,
          estado: "DERIVADO", actorDerivacion: `usuario:${beto}`, establecimiento: eess,
        });
        const sinPersona = await sembrarCaso(contexto, { categoria: C.QUEJA });
        const delSistema = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", actorRevision: "sistema:prueba" });
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const responsable = async (codigo: string) => (await agente.get(`/incidencias/${codigo}`)).body.responsable;

        expect(await responsable(corregido.codigo)).toBe("Ana Corrige");
        expect(await responsable(derivado.codigo)).toBe("Beto Deriva");
        expect(await responsable(sinPersona.codigo)).toBeNull();
        expect(await responsable(delSistema.codigo)).toBe("Sistema");
      });
    });
  });

  describe("campana de avisos: por vencer", () => {
    async function resumen(agente: AgentePrueba) {
      const res = await agente.get("/incidencias/por-vencer");
      expect(res.status).toBe(200);
      return res.body as { total: number; porVencer: number; vencidos: number; casos: CasoDto[] };
    }

    const delta = (despues: { porVencer: number; vencidos: number; total: number }, antes: { porVencer: number; vencidos: number; total: number }) => ({
      porVencer: despues.porVencer - antes.porVencer,
      vencidos: despues.vencidos - antes.vencidos,
      total: despues.total - antes.total,
    });

    it("cuenta lo que a cada persona le toca atender y por vencer, y baja cuando se deriva o se resuelve", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const otroEess = await crearEstablecimientoDePrueba(contexto);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const gestor = await entrar(contexto, app, [R.GESTOR]);
        const delEess = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        const delOtro = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, otroEess);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const antesAdmin = await resumen(admin.agente);
        const antesGestor = await resumen(gestor.agente);
        const antesEess = await resumen(delEess.agente);
        const antesOtro = await resumen(delOtro.agente);
        const antesOtrans = await resumen(otrans.agente);

        await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 10, establecimiento: eess });
        const sinRevisarB = await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 60, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", edadHoras: 70, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 80, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION", edadHoras: 90, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "RESUELTO", edadHoras: 100, resueltoHaceHoras: 5, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "ARCHIVADO", edadHoras: 200, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, edadHoras: 61, establecimiento: eess });

        const admin2 = await resumen(admin.agente);
        expect(delta(admin2, antesAdmin)).toEqual({ porVencer: 3, vencidos: 2, total: 5 });
        expect(admin2.total).toBe(admin2.porVencer + admin2.vencidos);

        const gestor2 = await resumen(gestor.agente);
        expect(delta(gestor2, antesGestor)).toEqual({ porVencer: 1, vencidos: 1, total: 2 });

        // El establecimiento cuenta lo derivado a su área y nunca la corrupción; otro establecimiento no cuenta nada.
        const eess2 = await resumen(delEess.agente);
        expect(delta(eess2, antesEess)).toEqual({ porVencer: 1, vencidos: 1, total: 2 });
        expect(delta(await resumen(delOtro.agente), antesOtro)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });
        expect(eess2.casos.every((c) => c.categoria !== "denuncia-corrupcion")).toBe(true);

        // OTRANS solo cuenta la corrupción que le toca revisar.
        expect(delta(await resumen(otrans.agente), antesOtrans)).toEqual({ porVencer: 1, vencidos: 0, total: 1 });

        expect((await gestor.agente.post(`/incidencias/${sinRevisarB.codigo}/confirmar`)).status).toBe(200);
        expect(delta(await resumen(gestor.agente), gestor2)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });

        expect((await gestor.agente.post(`/incidencias/${sinRevisarB.codigo}/derivar`)).status).toBe(200);
        expect(delta(await resumen(gestor.agente), gestor2)).toEqual({ porVencer: -1, vencidos: 0, total: -1 });
        const eess3 = await resumen(delEess.agente);
        expect(delta(eess3, eess2)).toEqual({ porVencer: 1, vencidos: 0, total: 1 });
        expect(delta(await resumen(delOtro.agente), antesOtro)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });
        expect((await resumen(admin.agente)).total).toBe(admin2.total);

        expect((await delEess.agente.post(`/incidencias/${sinRevisarB.codigo}/tomar`)).status).toBe(200);
        expect(delta(await resumen(delEess.agente), eess3)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });

        expect((await delEess.agente.post(`/incidencias/${sinRevisarB.codigo}/resolver`).send({ resolucion: "Atendido." })).status).toBe(200);
        expect(delta(await resumen(delEess.agente), eess3)).toEqual({ porVencer: -1, vencidos: 0, total: -1 });
        expect((await resumen(admin.agente)).total).toBe(admin2.total - 1);
      });
    });

    it("la lista corta trae lo más urgente primero, con tope de 10, y solo lo que el rol ve", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        for (let n = 0; n < 12; n += 1) await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 50 + n });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, edadHoras: 200 });
        const { agente } = await entrar(contexto, app, [R.GESTOR]);

        const res = await resumen(agente);
        expect(res.casos.length).toBe(10);
        expect(res.total).toBeGreaterThanOrEqual(12);
        const horas = res.casos.map((c) => c.horasDesdeLlegada as number);
        expect(horas).toEqual([...horas].sort((x, y) => y - x));
        expect(res.casos.map((c) => c.codigo)).not.toContain(corrupcion.codigo);
        for (const caso of res.casos) {
          expect(["por-vencer", "vencido"]).toContain((caso.plazo as { estado: string }).estado);
          expect(Array.isArray(caso.acciones)).toBe(true);
        }
      });
    });

    it("un archivado, un resuelto o un caso en plazo no cuentan", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        const antes = await resumen(agente);
        await sembrarCaso(contexto, { categoria: C.RECLAMO, edadHoras: 5, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.RECLAMO, estado: "RESUELTO", edadHoras: 300, resueltoHaceHoras: 100, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.RECLAMO, estado: "ARCHIVADO", edadHoras: 300, establecimiento: eess });
        const despues = await resumen(agente);
        expect(despues.total).toBe(antes.total);
      });
    });
  });
});
