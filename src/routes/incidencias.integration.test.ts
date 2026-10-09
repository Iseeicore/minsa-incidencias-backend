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
import { IncidenciaService, plazosDeEntorno } from "@/services/incidencia.service.js";
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

/** Quien es de OTRANS pertenece al área OTRANS; el gestor y el responsable de establecimiento, al área del establecimiento dado. */
function areaDe(roles: string[], eess?: EstablecimientoDePrueba): string | null {
  if (roles.includes(R.OTRANS)) return "OTRANS";
  if (roles.includes(R.ESTABLECIMIENTO) || roles.includes(R.GESTOR)) {
    if (!eess) throw new Error("un gestor o un responsable de establecimiento necesita su establecimiento");
    return eess.areaCodigo;
  }
  return null;
}

/** Cuerpos válidos de las acciones con datos. */
const RESOLUCION_VALIDA = { medidasTomadas: "Se corrigió el horario de atención.", fundamento: "El reclamo era procedente.", resultado: "ATENDIDO" };
const ARCHIVO_VALIDO = { motivo: "NO_CORRESPONDE", detalle: "No corresponde a este establecimiento." };
const REAPERTURA_VALIDA = { motivo: "Llegaron los datos que faltaban." };

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
    it("el administrador no filtra por área; el gestor, OTRANS y cada establecimiento solo ven lo destinado a su área", async () => {
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
        const app = construir(contexto);

        const vistos = async (roles: string[], eess?: EstablecimientoDePrueba) =>
          codigosVistos((await entrar(contexto, app, roles, undefined, eess)).agente, marcador);

        // Al clasificarse, la base destina cada caso no sensible al área de su establecimiento de origen.
        expect(await vistos([R.ADMINISTRADOR])).toEqual(ordenados(...todos));
        expect(await vistos([R.OTRANS])).toEqual(ordenados(corrupcion));
        expect(await vistos([R.ESTABLECIMIENTO], a)).toEqual(ordenados(quejaA, sinDerivar, otro));
        expect(await vistos([R.ESTABLECIMIENTO], b)).toEqual(ordenados(quejaB, deAaB));
        // El gestor ya no es global: ve exactamente lo mismo que el responsable de su establecimiento.
        expect(await vistos([R.GESTOR], a)).toEqual(ordenados(quejaA, sinDerivar, otro));
        expect(await vistos([R.GESTOR], b)).toEqual(ordenados(quejaB, deAaB));
        expect(await vistos([R.GESTOR, R.ESTABLECIMIENTO], a)).toEqual(ordenados(quejaA, sinDerivar, otro));
        expect(sinCategoria.codigo).toBeDefined();
      });
    });

    it("la bandeja de archivados de un establecimiento solo trae los de su área, con el motivo y sin tocar el cursor", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const archivadosA = [];
        for (let n = 0; n < 4; n += 1) {
          archivadosA.push(
            await sembrarCaso(contexto, {
              categoria: C.QUEJA, establecimiento: a, marcador, edadHoras: 10 + n,
              archivar: { motivo: n % 2 === 0 ? "NO_CORRESPONDE" : "DATOS_INSUFICIENTES" },
            }),
          );
        }
        const archivadoB = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: b, marcador, archivar: { motivo: "NO_CORRESPONDE" } });
        const abiertoA = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: a, marcador });
        const corrupcionArchivada = await sembrarCaso(contexto, {
          categoria: C.DENUNCIA_CORRUPCION, establecimiento: a, marcador, archivar: { motivo: "NO_CORRESPONDE" },
        });
        const app = construir(contexto);
        const delA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
        const gestorA = await entrar(contexto, app, [R.GESTOR], undefined, a);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const esperados = archivadosA.map((c) => c.codigo);

        for (const agente of [delA.agente, gestorA.agente]) {
          const recorrido: string[] = [];
          let cursor: string | undefined;
          do {
            const res = await agente.get("/incidencias").query({ texto: marcador, estado: "archivado", limite: "3", ...(cursor ? { cursor } : {}) });
            expect(res.status).toBe(200);
            recorrido.push(...(res.body.items as CasoDto[]).map((c) => c.codigo));
            cursor = res.body.siguiente ?? undefined;
          } while (cursor);
          expect(recorrido).toEqual(esperados);
          expect(recorrido).not.toContain(archivadoB.codigo);
          expect(recorrido).not.toContain(corrupcionArchivada.codigo);
          expect(recorrido).not.toContain(abiertoA.codigo);
        }
        expect((await delA.agente.get(`/incidencias/${archivadoB.codigo}`)).status).toBe(404);
        expect((await delA.agente.get(`/incidencias/${corrupcionArchivada.codigo}`)).status).toBe(404);

        const porMotivo = async (agente: AgentePrueba, motivoArchivo: string) =>
          ((await agente.get("/incidencias").query({ texto: marcador, estado: "archivado", motivoArchivo })).body.items as CasoDto[]).map((c) => c.codigo);
        expect(await porMotivo(delA.agente, "NO_CORRESPONDE")).toEqual([archivadosA[0], archivadosA[2]].map((c) => (c as { codigo: string }).codigo));
        expect(await porMotivo(delA.agente, "DATOS_INSUFICIENTES")).toEqual([archivadosA[1], archivadosA[3]].map((c) => (c as { codigo: string }).codigo));
        expect(await porMotivo(delA.agente, "VENCIDA_SIN_ATENDER")).toEqual([]);
        expect(await porMotivo(otrans.agente, "NO_CORRESPONDE")).toEqual([corrupcionArchivada.codigo]);
        expect((await porMotivo(admin.agente, "NO_CORRESPONDE")).sort()).toEqual(
          [archivadosA[0], archivadosA[2], archivadoB, corrupcionArchivada].map((c) => (c as { codigo: string }).codigo).sort(),
        );
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
        for (const rol of [R.ESTABLECIMIENTO, R.GESTOR]) {
          // La base ya no deja un rol de área sin área; se simula quitándosela después de crear al usuario.
          const correo = await crearUsuarioDePrueba(contexto, [rol], undefined, undefined, a.areaCodigo);
          const agente = await iniciarSesion(construir(contexto), correo);
          await contexto.client.query("ALTER TABLE gestion.usuario_interno DISABLE TRIGGER USER");
          await contexto.client.query("UPDATE gestion.usuario_interno SET area_id = NULL WHERE correo = $1", [correo]);
          await contexto.client.query("ALTER TABLE gestion.usuario_interno ENABLE TRIGGER USER");
          expect(await codigosVistos(agente, marcador)).toEqual([]);
          expect((await agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
        }
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
          expect((await agente.post(`/incidencias/${ajeno.codigo}/corregir`).send({ categoria: "otro" })).status).toBe(404);
          expect((await agente.post(`/incidencias/${ajeno.codigo}/resolver`).send(RESOLUCION_VALIDA)).status).toBe(404);
          expect((await agente.post(`/incidencias/${ajeno.codigo}/archivar`).send(ARCHIVO_VALIDO)).status).toBe(404);
          expect((await agente.post(`/incidencias/${ajeno.codigo}/reabrir`).send(REAPERTURA_VALIDA)).status).toBe(404);
        }
        const filas = await contexto.database.query<{ estado: string; medidas_tomadas: string | null; confirmada: boolean }>(
          `SELECT e.codigo AS estado, i.medidas_tomadas, (i.categoria_confirmada_en IS NOT NULL) AS confirmada
             FROM chatbot.incidencia_paciente i JOIN catalogo.estado_incidencia e ON e.id = i.estado_incidencia_id
            WHERE i.id = ANY($1) ORDER BY e.codigo`,
          [[deA.id, corrupcion.id]],
        );
        expect(filas).toEqual([
          { estado: "CLASIFICADO", medidas_tomadas: null, confirmada: false },
          { estado: "DERIVADO", medidas_tomadas: null, confirmada: true },
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
        const eess = await crearEstablecimientoDePrueba(contexto, "Hospital Contrato");
        const revisor = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Ana Prueba", undefined, eess.areaCodigo);
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
            "acciones", "archivo", "area", "categoria", "categoriaIa", "codigo", "confianzaIa", "corregida", "descripcion", "estado",
            "establecimiento", "etiquetas", "evidencias", "historial", "horasDesdeLlegada", "horasDesdeResolucion", "organismo", "plazo",
            "prioridad", "reapertura", "reclamante", "resolucion", "responsable", "revisadoPorHumano",
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
          area: { codigo: eess.areaCodigo, nombre: eess.areaNombre },
          establecimiento: { codigoRenipress: eess.codigoRenipress, nombre: eess.nombre, nivelAtencion: null, categoria: null },
          responsable: "Ana Prueba",
          estado: "clasificado",
          horasDesdeLlegada: 20,
          horasDesdeResolucion: null,
          revisadoPorHumano: true,
          corregida: false,
          resolucion: null,
          archivo: null,
          reapertura: null,
          descripcion: caso.descripcion,
          reclamante: "Luis A. · DNI ••••1907",
          acciones: ["derivar", "archivar"],
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

    it("un reporte anónimo no muestra a la persona y un caso archivado no tiene plazo y solo se puede reabrir", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const anonimo = await sembrarCaso(contexto, { categoria: C.QUEJA, anonimo: true });
        const archivado = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "ARCHIVADO" });
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);

        expect((await agente.get(`/incidencias/${anonimo.codigo}`)).body.reclamante).toBe("Anónimo");
        const res = await agente.get(`/incidencias/${archivado.codigo}`);
        expect(res.body).toMatchObject({
          estado: "archivado",
          acciones: ["reabrir"],
          plazo: { tipo: null, estado: null, venceEn: null, horasRestantes: null },
          resolucion: {
            medidasTomadas: "Se atendió el caso en la prueba.",
            fundamento: "El caso era procedente en la prueba.",
            resultado: "ATENDIDO",
          },
          archivo: { motivo: "RESUELTA_VIGENCIA", detalle: null },
          reapertura: null,
        });
        expect(new Date(res.body.archivo.archivadoEn).toString()).not.toBe("Invalid Date");
        expect(Object.keys(res.body.resolucion).sort()).toEqual(["fundamento", "medidasTomadas", "resultado"]);
        expect(Object.keys(res.body.archivo).sort()).toEqual(["archivadoEn", "detalle", "motivo"]);
      });
    });

    it("un archivado manual trae su motivo y su detalle; uno reabierto trae la reapertura, que se conserva si vuelve a archivarse", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, {
          categoria: C.QUEJA, establecimiento: eess,
          archivar: { desde: "DERIVADO", motivo: "DATOS_INSUFICIENTES", detalle: "Faltan los datos de contacto." },
        });
        const { agente } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], undefined, eess);

        const archivado = await agente.get(`/incidencias/${caso.codigo}`);
        expect(archivado.body).toMatchObject({
          estado: "archivado",
          resolucion: null,
          archivo: { motivo: "DATOS_INSUFICIENTES", detalle: "Faltan los datos de contacto." },
          reapertura: null,
          acciones: ["reabrir"],
        });

        const reabierto = await agente.post(`/incidencias/${caso.codigo}/reabrir`).send({ motivo: "Llegaron los datos pedidos." });
        expect(reabierto.status).toBe(200);
        expect(reabierto.body.caso).toMatchObject({
          estado: "en-gestion",
          archivo: null,
          reapertura: { motivo: "Llegaron los datos pedidos." },
          acciones: ["resolver", "archivar"],
        });
        expect(Object.keys(reabierto.body.caso.reapertura).sort()).toEqual(["motivo", "reabiertoEn"]);
        expect(new Date(reabierto.body.caso.reapertura.reabiertoEn).toString()).not.toBe("Invalid Date");

        const otraVez = await agente.post(`/incidencias/${caso.codigo}/archivar`).send({ motivo: "NO_CORRESPONDE", detalle: "Tampoco corresponde, segunda vez." });
        expect(otraVez.status).toBe(200);
        expect(otraVez.body.caso).toMatchObject({
          estado: "archivado",
          archivo: { motivo: "NO_CORRESPONDE", detalle: "Tampoco corresponde, segunda vez." },
          reapertura: { motivo: "Llegaron los datos pedidos." },
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
    const delArea = (rol: string, nombre: string, deriva: boolean): [string, string[], OpcionesCaso, string[]][] => [
      [`${nombre}, queja clasificada sin revisar`, [rol], { categoria: C.QUEJA }, ["confirmar", "corregir", "archivar"]],
      [`${nombre}, caso otro sin revisar`, [rol], { categoria: C.OTRO }, ["confirmar", "corregir", "archivar"]],
      [`${nombre}, queja revisada: toma directo${deriva ? " o deriva" : ", no deriva"}`, [rol], { categoria: C.QUEJA, revision: "confirmada" }, deriva ? ["derivar", "tomar", "archivar"] : ["tomar", "archivar"]],
      [`${nombre}, reclamo corregido: toma directo`, [rol], { categoria: C.RECLAMO, revision: "corregida", corregidaA: C.QUEJA }, deriva ? ["derivar", "tomar", "archivar"] : ["tomar", "archivar"]],
      [`${nombre}, caso otro revisado`, [rol], { categoria: C.OTRO, revision: "confirmada" }, deriva ? ["derivar", "tomar", "archivar"] : ["tomar", "archivar"]],
      [`${nombre}, queja derivada`, [rol], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver", "archivar"]],
      [`${nombre}, reclamo derivado`, [rol], { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver", "archivar"]],
      [`${nombre}, queja en gestión`, [rol], { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION" }, ["resolver", "archivar"]],
      [`${nombre}, queja resuelta`, [rol], { categoria: C.QUEJA, revision: "confirmada", estado: "RESUELTO" }, []],
      [`${nombre}, queja archivada a mano`, [rol], { categoria: C.QUEJA, archivar: { motivo: "NO_CORRESPONDE" } }, ["reabrir"]],
      [`${nombre}, queja archivada por vencimiento`, [rol], { categoria: C.QUEJA, archivar: { motivo: "VENCIDA_SIN_ATENDER" } }, ["reabrir"]],
      [`${nombre}, queja archivada por la vigencia de su resolución (la base no deja reabrirla)`, [rol], { categoria: C.QUEJA, estado: "ARCHIVADO" }, ["reabrir"]],
    ];

    const filas: [string, string[], OpcionesCaso, string[]][] = [
      ...delArea(R.GESTOR, "gestor", true),
      ...delArea(R.ESTABLECIMIENTO, "establecimiento", false),
      ["gestor y establecimiento, queja derivada", [R.GESTOR, R.ESTABLECIMIENTO], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver", "archivar"]],
      ["gestor y establecimiento, queja revisada: deriva", [R.GESTOR, R.ESTABLECIMIENTO], { categoria: C.QUEJA, revision: "confirmada" }, ["derivar", "tomar", "archivar"]],

      ["administrador, queja sin revisar", [R.ADMINISTRADOR], { categoria: C.QUEJA }, ["confirmar", "corregir", "archivar"]],
      ["administrador, corrupción sin revisar", [R.ADMINISTRADOR], { categoria: C.DENUNCIA_CORRUPCION }, ["confirmar", "corregir", "archivar"]],
      ["administrador, queja revisada: deriva", [R.ADMINISTRADOR], { categoria: C.QUEJA, revision: "confirmada" }, ["derivar", "archivar"]],
      ["administrador, caso otro revisado: deriva", [R.ADMINISTRADOR], { categoria: C.OTRO, revision: "confirmada" }, ["derivar", "archivar"]],
      ["administrador, queja derivada: ni toma ni resuelve", [R.ADMINISTRADOR], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, ["archivar"]],
      ["administrador, queja en gestión", [R.ADMINISTRADOR], { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION" }, ["archivar"]],
      ["administrador, queja resuelta", [R.ADMINISTRADOR], { categoria: C.QUEJA, estado: "RESUELTO" }, []],
      ["administrador, corrupción archivada", [R.ADMINISTRADOR], { categoria: C.DENUNCIA_CORRUPCION, archivar: { motivo: "DATOS_INSUFICIENTES" } }, ["reabrir"]],

      ["OTRANS, sin revisar", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION }, ["confirmar", "corregir", "archivar"]],
      ["OTRANS, revisada: deriva o toma directo", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada" }, ["derivar", "tomar", "archivar"]],
      ["OTRANS, derivada", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver", "archivar"]],
      ["OTRANS, en gestión", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", estado: "EN_GESTION" }, ["resolver", "archivar"]],
      ["OTRANS, archivada a mano", [R.OTRANS], { categoria: C.DENUNCIA_CORRUPCION, archivar: { motivo: "NO_CORRESPONDE" } }, ["reabrir"]],
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
        const eess = await crearEstablecimientoDePrueba(contexto);
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, marcador, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        await sembrarCaso(contexto, { categoria: null, marcador, establecimiento: eess });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR], undefined, eess);
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
          const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
          const gestorDeB = await entrar(contexto, app, [R.GESTOR], undefined, b);
          const ver = async (agente: AgentePrueba, establecimiento: string) =>
            ((await agente.get("/incidencias").query({ texto: marcador, establecimiento })).body.items as CasoDto[]).map((c) => c.codigo).sort();

          expect(await ver(delA.agente, a.codigoRenipress)).toEqual([origenAdestinoA.codigo]);
          expect(await ver(delA.agente, b.codigoRenipress)).toEqual([]);
          expect(await ver(delB.agente, a.codigoRenipress)).toEqual([origenAdestinoB.codigo]);
          expect(await ver(gestorDeB.agente, a.codigoRenipress)).toEqual([origenAdestinoB.codigo]);
          expect(await ver(admin.agente, a.codigoRenipress)).toEqual([origenAdestinoA.codigo, origenAdestinoB.codigo].sort());
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

  describe("filtro por rango de fechas de llegada (días de Lima)", () => {
    /** Fija el instante de llegada de un caso (con los disparadores apagados un momento, como hace el sembrado para dar edad). */
    async function llegoEl(contexto: RollbackContext, caso: { id: string }, instante: string) {
      await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente DISABLE TRIGGER USER");
      await contexto.client.query("UPDATE chatbot.incidencia_paciente SET fecha_creacion = $2::timestamptz WHERE id = $1", [caso.id, instante]);
      await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente ENABLE TRIGGER USER");
    }

    async function sembrarBordes(contexto: RollbackContext, marcador: string) {
      const sembrar = async (instante: string) => {
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        await llegoEl(contexto, caso, instante);
        return caso.codigo;
      };
      return {
        anteriorAlDia9: await sembrar("2026-03-08T23:59:59-05:00"),
        noche10: await sembrar("2026-03-10T23:30:00-05:00"),
        inicio11: await sembrar("2026-03-11T00:00:00-05:00"),
        fin11: await sembrar("2026-03-11T23:59:59.999-05:00"),
        inicio12: await sembrar("2026-03-12T00:00:00-05:00"),
      };
    }

    const verCodigos = async (agente: AgentePrueba, query: Record<string, string>) => {
      const res = await agente.get("/incidencias").query({ limite: "100", ...query });
      expect(res.status).toBe(200);
      return (res.body.items as CasoDto[]).map((c) => c.codigo);
    };

    it("un caso que llegó a las 23:30 de Lima cuenta en ese día aunque en UTC ya sea el siguiente", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const c = await sembrarBordes(contexto, marcador);
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

        expect(await verCodigos(agente, { texto: marcador, desde: "2026-03-10", hasta: "2026-03-10" })).toEqual([c.noche10]);
        expect(await verCodigos(agente, { texto: marcador, desde: "2026-03-11", hasta: "2026-03-11" })).toEqual([c.fin11, c.inicio11]);
        expect(await verCodigos(agente, { texto: marcador, desde: "2026-03-12", hasta: "2026-03-12" })).toEqual([c.inicio12]);
      });
    });

    it("desde y hasta son inclusivos; con uno solo, el otro extremo queda abierto", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const c = await sembrarBordes(contexto, marcador);
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

        expect(await verCodigos(agente, { texto: marcador, desde: "2026-03-10", hasta: "2026-03-11" })).toEqual([c.fin11, c.inicio11, c.noche10]);
        expect(await verCodigos(agente, { texto: marcador, desde: "2026-03-11" })).toEqual([c.inicio12, c.fin11, c.inicio11]);
        expect(await verCodigos(agente, { texto: marcador, hasta: "2026-03-10" })).toEqual([c.noche10, c.anteriorAlDia9]);
        expect(await verCodigos(agente, { texto: marcador })).toHaveLength(5);
        expect(await verCodigos(agente, { texto: marcador, desde: "2026-03-13" })).toEqual([]);
      });
    });

    it("se combina con estado, categoría, texto y establecimiento", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const sembrar = async (opciones: OpcionesCaso, instante: string) => {
          const caso = await sembrarCaso(contexto, { marcador, ...opciones });
          await llegoEl(contexto, caso, instante);
          return caso.codigo;
        };
        const dentro = "2026-03-11T10:00:00-05:00";
        const quejaA = await sembrar({ categoria: C.QUEJA, establecimiento: a }, dentro);
        const reclamoA = await sembrar({ categoria: C.RECLAMO, establecimiento: a }, dentro);
        const derivadaB = await sembrar({ categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: b }, dentro);
        await sembrar({ categoria: C.QUEJA, establecimiento: a }, "2026-03-20T10:00:00-05:00");
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const rango = { texto: marcador, desde: "2026-03-11", hasta: "2026-03-11" };

        expect((await verCodigos(agente, rango)).sort()).toEqual([quejaA, reclamoA, derivadaB].sort());
        expect(await verCodigos(agente, { ...rango, categoria: "reclamo" })).toEqual([reclamoA]);
        expect(await verCodigos(agente, { ...rango, estado: "derivado" })).toEqual([derivadaB]);
        expect((await verCodigos(agente, { ...rango, establecimiento: a.codigoRenipress })).sort()).toEqual([quejaA, reclamoA].sort());
        expect(await verCodigos(agente, { ...rango, establecimiento: a.codigoRenipress, categoria: "reclamo", estado: "en-gestion" })).toEqual([]);
      });
    });

    it("la bandeja de archivados también se acota por rango", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const dentro = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, archivar: { motivo: "NO_CORRESPONDE" } });
        const fuera = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, archivar: { motivo: "NO_CORRESPONDE" } });
        await llegoEl(contexto, dentro, "2026-03-11T08:00:00-05:00");
        await llegoEl(contexto, fuera, "2026-04-11T08:00:00-05:00");
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        expect(
          await verCodigos(agente, { texto: marcador, estado: "archivado", motivoArchivo: "NO_CORRESPONDE", desde: "2026-03-01", hasta: "2026-03-31" }),
        ).toEqual([dentro.codigo]);
      });
    });

    it("no amplía la visibilidad: el establecimiento no recibe casos de otra área ni corrupción por estar en el rango", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const dia = "2026-03-11T10:00:00-05:00";
        const propia = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: a, marcador });
        const deOtraArea = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: b, marcador });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: a, marcador });
        for (const caso of [propia, deOtraArea, corrupcion]) await llegoEl(contexto, caso, dia);
        const app = construir(contexto);
        const usuarioA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const rango = { texto: marcador, desde: "2026-03-11", hasta: "2026-03-11" };

        expect(await verCodigos(usuarioA.agente, rango)).toEqual([propia.codigo]);
        expect(await verCodigos(usuarioA.agente, { texto: marcador, desde: "2026-03-01", hasta: "2026-03-31" })).toEqual([propia.codigo]);
        expect((await verCodigos(admin.agente, rango)).sort()).toEqual([propia.codigo, deOtraArea.codigo, corrupcion.codigo].sort());
        expect(await verCodigos(otrans.agente, rango)).toEqual([corrupcion.codigo]);
      });
    });

    it("con cursor recorre el rango sin repetir ni saltar, y hayMas y siguiente no cambian de significado", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const dentro = [];
        for (let n = 0; n < 7; n += 1) {
          const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
          await llegoEl(contexto, caso, `2026-03-11T${String(22 - n).padStart(2, "0")}:00:00-05:00`);
          dentro.push(caso);
        }
        // Dos casos con exactamente el mismo instante: se desempatan por id y el cursor no los repite.
        const gemelos = [await sembrarCaso(contexto, { categoria: C.QUEJA, marcador }), await sembrarCaso(contexto, { categoria: C.QUEJA, marcador })];
        for (const g of gemelos) await llegoEl(contexto, g, "2026-03-11T01:00:00-05:00");
        const fuera = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        await llegoEl(contexto, fuera, "2026-03-12T00:00:00-05:00");
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const esperado = await contexto.database.query<{ codigo: string }>(
          `SELECT codigo FROM chatbot.incidencia_paciente
            WHERE id = ANY($1) AND fecha_creacion < '2026-03-12T00:00:00-05:00'
            ORDER BY fecha_creacion DESC, id DESC`,
          [[...dentro, ...gemelos, fuera].map((c) => c.id)],
        );

        for (const limite of [1, 2, 4, 9, 50]) {
          const vistos: string[] = [];
          let cursor: string | undefined;
          let paginas = 0;
          do {
            const res = await agente
              .get("/incidencias")
              .query({ texto: marcador, desde: "2026-03-11", hasta: "2026-03-11", limite: String(limite), ...(cursor ? { cursor } : {}) });
            expect(res.status).toBe(200);
            vistos.push(...(res.body.items as CasoDto[]).map((c) => c.codigo));
            expect(res.body.hayMas).toBe(res.body.siguiente !== null);
            cursor = res.body.siguiente ?? undefined;
            paginas += 1;
          } while (cursor);
          expect(vistos).toEqual(esperado.map((f) => f.codigo));
          expect(paginas).toBe(Math.ceil(9 / limite));
        }

        // Un cursor emitido sin rango sigue siendo válido al añadirle el rango: es solo la posición del último caso.
        const sinRango = await agente.get("/incidencias").query({ texto: marcador, limite: "1" });
        const conRango = await agente.get("/incidencias").query({ texto: marcador, limite: "100", desde: "2026-03-11", hasta: "2026-03-11", cursor: sinRango.body.siguiente });
        expect(conRango.status).toBe(200);
        expect((conRango.body.items as CasoDto[]).map((c) => c.codigo)).toEqual(esperado.map((f) => f.codigo));
      });
    });

    it("rechaza con 400 una fecha inexistente, un rango invertido y uno de más de 366 días", async () => {
      await usar(async (contexto) => {
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        for (const query of [
          { desde: "2026-02-31" },
          { hasta: "2026-13-01" },
          { desde: "2026-03-12", hasta: "2026-03-11" },
          { desde: "2025-01-01", hasta: "2026-01-02" },
          { desde: "1'; DROP TABLE chatbot.incidencia_paciente; --" },
        ]) {
          const res = await agente.get("/incidencias").query(query);
          expect(res.status).toBe(400);
          expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        }
        expect((await agente.get("/incidencias").query({ desde: "2025-03-11", hasta: "2026-03-11" })).status).toBe(200);
      });
    });

    it("la búsqueda por texto encuentra el código solo con su número, sin el prefijo MINSA-AAAA-", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const numero = caso.codigo.split("-").at(-1) as string;
        expect(numero).toMatch(/^\d{6,}$/);
        expect(await verCodigos(agente, { texto: numero })).toContain(caso.codigo);
        expect(await verCodigos(agente, { texto: caso.codigo })).toEqual([caso.codigo]);
        expect(await verCodigos(agente, { texto: caso.codigo.toLowerCase() })).toEqual([caso.codigo]);
      });
    });
  });

  describe("conteos de las pestañas de la bandeja", () => {
    interface ConteoDto {
      cantidad: number;
      conMas: boolean;
    }
    interface ConteosDto {
      todos: ConteoDto;
      total: ConteoDto;
      porEstado: Record<string, ConteoDto>;
    }
    const ESTADOS = ["registrado", "clasificado", "derivado", "en-gestion", "resuelto", "archivado"];
    const exacto = (cantidad: number): ConteoDto => ({ cantidad, conMas: false });

    async function conteos(agente: AgentePrueba, query: Record<string, string> = {}): Promise<ConteosDto> {
      const res = await agente.get("/incidencias/conteos").query(query);
      expect(res.status).toBe(200);
      return res.body as ConteosDto;
    }

    const resumen = (c: ConteosDto) => ({ todos: c.todos.cantidad, total: c.total.cantidad, ...Object.fromEntries(ESTADOS.map((e) => [e, c.porEstado[e]?.cantidad])) });

    /** Recorre el listado completo siguiendo el cursor, de a `limite` casos por página. */
    async function recorrer(agente: AgentePrueba, query: Record<string, string>, limite = 3): Promise<string[]> {
      const codigos: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await agente.get("/incidencias").query({ ...query, limite: String(limite), ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        codigos.push(...(res.body.items as CasoDto[]).map((c) => c.codigo));
        cursor = res.body.siguiente as string | null;
      } while (cursor);
      return codigos;
    }

    async function llegoEl(contexto: RollbackContext, caso: { id: string }, instante: string) {
      await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente DISABLE TRIGGER USER");
      await contexto.client.query("UPDATE chatbot.incidencia_paciente SET fecha_creacion = $2::timestamptz WHERE id = $1", [caso.id, instante]);
      await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente ENABLE TRIGGER USER");
    }

    /** Dos registrados, un clasificado, un derivado, uno en gestión, uno resuelto y dos archivados (uno manual y otro por vigencia). */
    async function sembrarDeTodosLosEstados(contexto: RollbackContext, marcador: string, eess: EstablecimientoDePrueba) {
      const base = { establecimiento: eess, marcador };
      await sembrarCaso(contexto, { ...base, categoria: null });
      await sembrarCaso(contexto, { ...base, categoria: null });
      await sembrarCaso(contexto, { ...base, categoria: C.QUEJA });
      await sembrarCaso(contexto, { ...base, categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO" });
      await sembrarCaso(contexto, { ...base, categoria: C.RECLAMO, revision: "confirmada", estado: "EN_GESTION" });
      await sembrarCaso(contexto, { ...base, categoria: C.QUEJA, revision: "confirmada", estado: "RESUELTO" });
      await sembrarCaso(contexto, { ...base, categoria: C.QUEJA, revision: "confirmada", estado: "ARCHIVADO" });
      await sembrarCaso(contexto, { ...base, categoria: C.QUEJA, archivar: { motivo: "NO_CORRESPONDE" } });
    }

    it("cuenta cada estado, con todos los estados presentes (0 si no hay) y los mismos códigos que emite el listado", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

        expect(await conteos(agente, { texto: marcador })).toEqual({
          todos: exacto(0),
          total: exacto(0),
          porEstado: Object.fromEntries(ESTADOS.map((e) => [e, exacto(0)])),
        });

        await sembrarDeTodosLosEstados(contexto, marcador, eess);
        const c = await conteos(agente, { texto: marcador });
        expect(Object.keys(c.porEstado).sort()).toEqual([...ESTADOS].sort());
        expect(resumen(c)).toEqual({ todos: 8, total: 8, registrado: 2, clasificado: 1, derivado: 1, "en-gestion": 1, resuelto: 1, archivado: 2 });
        expect(c.todos.conMas).toBe(false);

        // Cada pestaña coincide con lo que el listado devuelve al filtrar por ese estado.
        for (const estado of ESTADOS) {
          expect((await recorrer(agente, { texto: marcador, estado })).length).toBe(c.porEstado[estado]?.cantidad);
        }
      });
    });

    it("total respeta estado y motivo del archivo; todos y porEstado no", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const eess = await crearEstablecimientoDePrueba(contexto);
        await sembrarDeTodosLosEstados(contexto, marcador, eess);
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const sinFiltrar = { todos: 8, registrado: 2, clasificado: 1, derivado: 1, "en-gestion": 1, resuelto: 1, archivado: 2 };

        expect(resumen(await conteos(agente, { texto: marcador, estado: "derivado" }))).toEqual({ ...sinFiltrar, total: 1 });
        expect(resumen(await conteos(agente, { texto: marcador, estado: "archivado" }))).toEqual({ ...sinFiltrar, total: 2 });
        expect(resumen(await conteos(agente, { texto: marcador, estado: "archivado", motivoArchivo: "NO_CORRESPONDE" }))).toEqual({ ...sinFiltrar, total: 1 });
        expect(resumen(await conteos(agente, { texto: marcador, motivoArchivo: "NO_CORRESPONDE" }))).toEqual({ ...sinFiltrar, total: 1 });
        expect(resumen(await conteos(agente, { texto: marcador, estado: "registrado", motivoArchivo: "NO_CORRESPONDE" }))).toEqual({ ...sinFiltrar, total: 0 });
        expect(resumen(await conteos(agente, { texto: marcador }))).toEqual({ ...sinFiltrar, total: 8 });
      });
    });

    it("los demás filtros (categoría, sin categoría, fechas, texto, establecimiento) acotan todos los contadores", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const dentro = "2026-03-11T10:00:00-05:00";
        const sembrar = async (opciones: OpcionesCaso, instante: string) => {
          const caso = await sembrarCaso(contexto, { marcador, ...opciones });
          await llegoEl(contexto, caso, instante);
        };
        await sembrar({ categoria: C.QUEJA, establecimiento: a }, dentro);
        await sembrar({ categoria: C.RECLAMO, establecimiento: a }, dentro);
        await sembrar({ categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", establecimiento: b }, dentro);
        await sembrar({ categoria: null, establecimiento: a }, dentro);
        await sembrar({ categoria: C.QUEJA, establecimiento: a }, "2026-03-20T10:00:00-05:00");
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const rango = { texto: marcador, desde: "2026-03-11", hasta: "2026-03-11" };

        expect(resumen(await conteos(agente, rango))).toMatchObject({ todos: 4, total: 4, registrado: 1, clasificado: 2, derivado: 1 });
        expect(resumen(await conteos(agente, { ...rango, categoria: "reclamo" }))).toMatchObject({ todos: 2, clasificado: 1, derivado: 1 });
        expect(resumen(await conteos(agente, { ...rango, categoria: "sin-categoria" }))).toMatchObject({ todos: 1, registrado: 1, clasificado: 0 });
        expect(resumen(await conteos(agente, { ...rango, establecimiento: a.codigoRenipress }))).toMatchObject({ todos: 3, derivado: 0, clasificado: 2 });
        expect(resumen(await conteos(agente, { ...rango, establecimiento: b.codigoRenipress, estado: "clasificado" }))).toMatchObject({ todos: 1, derivado: 1, total: 0 });
        expect(resumen(await conteos(agente, { texto: marcador, desde: "2026-03-12" }))).toMatchObject({ todos: 1, clasificado: 1 });
        expect(resumen(await conteos(agente, { texto: "texto-que-no-existe-" + marcador }))).toMatchObject({ todos: 0, total: 0 });
      });
    });

    describe("tope de cada contador", () => {
      const servicioConTope = (contexto: RollbackContext, tope: number) =>
        new IncidenciaService(new IncidenciaRepository(contexto.database), contexto.database, plazosDeEntorno(testEnv()), tope);
      const administrador = { sesionId: "s", usuarioId: "u", correo: "a@minsa.gob.pe", nombreCompleto: "Admin", roles: [R.ADMINISTRADOR], area: null, vistas: [] };

      it("cuenta hasta el tope y avisa con conMas si hay más; por debajo o justo en el tope es exacto", async () => {
        await usar(async (contexto) => {
          const marcador = marcaDePrueba();
          const eess = await crearEstablecimientoDePrueba(contexto);
          const base = { establecimiento: eess, marcador };
          await sembrarCaso(contexto, { ...base, categoria: C.QUEJA });
          await sembrarCaso(contexto, { ...base, categoria: C.QUEJA });
          await sembrarCaso(contexto, { ...base, categoria: C.QUEJA });
          await sembrarCaso(contexto, { ...base, categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO" });

          const tope2 = await servicioConTope(contexto, 2).conteos(administrador, { texto: marcador });
          expect(tope2.porEstado["clasificado"]).toEqual({ cantidad: 2, conMas: true });
          expect(tope2.porEstado["derivado"]).toEqual(exacto(1));
          expect(tope2.porEstado["registrado"]).toEqual(exacto(0));
          expect(tope2.todos).toEqual({ cantidad: 2, conMas: true });
          expect(tope2.total).toEqual({ cantidad: 2, conMas: true });

          const tope3 = await servicioConTope(contexto, 3).conteos(administrador, { texto: marcador, estado: "clasificado" });
          expect(tope3.porEstado["clasificado"]).toEqual(exacto(3));
          expect(tope3.todos).toEqual({ cantidad: 3, conMas: true });
          expect(tope3.total).toEqual(exacto(3));

          const tope4 = await servicioConTope(contexto, 4).conteos(administrador, { texto: marcador });
          expect(tope4.todos).toEqual(exacto(4));
          expect(tope4.total).toEqual(exacto(4));
        });
      });

      it("el repositorio nunca cuenta más de tope + 1 filas", async () => {
        await usar(async (contexto) => {
          const marcador = marcaDePrueba();
          const eess = await crearEstablecimientoDePrueba(contexto);
          for (let n = 0; n < 4; n += 1) await sembrarCaso(contexto, { establecimiento: eess, marcador, categoria: C.QUEJA });
          const repo = new IncidenciaRepository(contexto.database);
          const visible = { roles: [R.ADMINISTRADOR], verSinCategoria: true, areaId: null };
          expect(await repo.contarAcotado(visible, { texto: marcador }, 2)).toBe(3);
          expect(await repo.contarAcotado(visible, { texto: marcador }, 10)).toBe(4);
          expect((await repo.contarPorEstado(visible, { texto: marcador }, 2)).get(EstadoIncidencia.CLASIFICADO)).toBe(3);
        });
      });
    });

    it("respeta la visibilidad: nunca cuenta corrupción para establecimiento ni gestor, ni casos de otra área", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await crearEstablecimientoDePrueba(contexto, "Hospital A");
        const b = await crearEstablecimientoDePrueba(contexto, "Hospital B");
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: a, marcador });
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a, marcador });
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: b, marcador });
        await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", establecimiento: a, destino: b, marcador });
        await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: a, marcador });
        await sembrarCaso(contexto, { categoria: C.OTRO, establecimiento: a, marcador });
        await sembrarCaso(contexto, { categoria: null, establecimiento: a, marcador });
        const app = construir(contexto);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const estabA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
        const estabB = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, b);
        const gestorA = await entrar(contexto, app, [R.GESTOR], undefined, a);

        const cuenta = async (u: { agente: AgentePrueba }) => (await conteos(u.agente, { texto: marcador })).todos.cantidad;
        expect(await cuenta(admin)).toBe(7);
        expect(await cuenta(otrans)).toBe(1);
        expect(await cuenta(estabA)).toBe(3);
        expect(await cuenta(estabB)).toBe(2);
        expect(await cuenta(gestorA)).toBe(3);
        // Lo que se cuenta es exactamente lo que el listado muestra, también por estado.
        for (const u of [admin, otrans, estabA, estabB, gestorA]) {
          const c = await conteos(u.agente, { texto: marcador });
          expect((await recorrer(u.agente, { texto: marcador })).length).toBe(c.todos.cantidad);
          for (const estado of ESTADOS) expect((await recorrer(u.agente, { texto: marcador, estado })).length).toBe(c.porEstado[estado]?.cantidad);
        }
        expect((await conteos(estabA.agente, { texto: marcador, categoria: "denuncia-corrupcion" })).todos.cantidad).toBe(0);
        expect((await conteos(gestorA.agente, { texto: marcador, categoria: "sin-categoria" })).todos.cantidad).toBe(0);
        expect((await conteos(otrans.agente, { texto: marcador, categoria: "queja" })).todos.cantidad).toBe(0);
      });
    });

    it("todos coincide con recorrer el listado completo de la base, con y sin filtros", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const eess = await crearEstablecimientoDePrueba(contexto);
        await sembrarDeTodosLosEstados(contexto, marcador, eess);
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess, marcador });
        const app = construir(contexto);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const estab = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);

        for (const u of [admin, estab]) {
          const variantes: Record<string, string>[] = [{},{ categoria: "queja" }, { desde: "2026-01-01" }, { estado: "archivado" }, { texto: marcador }];
          for (const filtros of variantes) {
            const c = await conteos(u.agente, filtros);
            const deLasPestanas = Object.fromEntries(Object.entries(filtros).filter(([clave]) => clave !== "estado" && clave !== "motivoArchivo"));
            expect(c.todos.cantidad).toBe((await recorrer(u.agente, deLasPestanas, 7)).length);
            expect(c.total.cantidad).toBe((await recorrer(u.agente, filtros, 7)).length);
          }
        }
      });
    });

    it("exige sesión y rechaza filtros inválidos con 400", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        expect((await request(app).get("/incidencias/conteos")).status).toBe(401);
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        for (const consulta of [
          { estado: "anulado" },
          { motivoArchivo: "otro" },
          { categoria: "corrupcion" },
          { establecimiento: "abc" },
          { desde: "2026-02-31" },
          { desde: "2026-03-12", hasta: "2026-03-11" },
          { desde: "2025-03-11", hasta: "2026-03-12" },
        ]) {
          const res = await agente.get("/incidencias/conteos").query(consulta);
          expect(res.status).toBe(400);
          expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        }
        expect((await agente.get("/incidencias/conteos").query({ desde: "2025-03-11", hasta: "2026-03-11" })).status).toBe(200);
      });
    });
  });

  describe("acciones", () => {
    it("confirmar: la base firma al usuario, el caso queda revisado y se copia al entrenamiento", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess });
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.GESTOR], "Gina Gestora", eess);

        const res = await agente.post(`/incidencias/${caso.codigo}/confirmar`);
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Categoría confirmada. Se guardó para mejorar la IA.");
        expect(res.body.caso).toMatchObject({
          codigo: caso.codigo, revisadoPorHumano: true, corregida: false, acciones: ["derivar", "tomar", "archivar"], responsable: "Gina Gestora",
        });

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

    it("el responsable del establecimiento también confirma los casos de su área", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: eess });
        const { agente } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], undefined, eess);
        const res = await agente.post(`/incidencias/${caso.codigo}/confirmar`);
        expect(res.status).toBe(200);
        expect(res.body.caso).toMatchObject({ revisadoPorHumano: true, acciones: ["tomar", "archivar"] });
      });
    });

    it("corregir: el gestor cambia la categoría entre queja, reclamo y otro; queda corregida y se copia al entrenamiento", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: eess });
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.GESTOR], undefined, eess);

        const res = await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "queja" });
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Categoría corregida. Se guardó para mejorar la IA.");
        expect(res.body.caso).toMatchObject({
          categoria: "queja", categoriaIa: "reclamo", corregida: true, revisadoPorHumano: true,
          area: { codigo: eess.areaCodigo, nombre: eess.areaNombre }, acciones: ["derivar", "tomar", "archivar"],
        });

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

    it("corregir a corrupción: el gestor y el responsable lo reclasifican, la respuesta no trae datos del caso y OTRANS lo recibe", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        for (const rol of [R.GESTOR, R.ESTABLECIMIENTO]) {
          const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: eess });
          const { agente, correo } = await entrar(contexto, app, [rol], undefined, eess);
          expect((await agente.get(`/incidencias/${caso.codigo}`)).status).toBe(200);

          const res = await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "denuncia-corrupcion" });
          expect(res.status).toBe(200);
          expect(res.body).toEqual({ codigo: caso.codigo, enviadoAOtrans: true });

          // Desaparece de su vista (lista, detalle y acciones) y aparece en OTRANS, ya revisado.
          expect((await agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
          expect((await agente.post(`/incidencias/${caso.codigo}/tomar`)).status).toBe(404);
          expect(await codigosVistos(agente, caso.codigo)).toEqual([]);
          expect(await accionesDe(otrans.agente, caso.codigo)).toEqual(["derivar", "tomar", "archivar"]);
          const [fila] = await contexto.database.query<{ categoria: string; area: string; por: string }>(
            `SELECT c.codigo AS categoria, a.codigo AS area, i.categoria_corregida_por AS por
               FROM chatbot.incidencia_paciente i
               JOIN catalogo.categoria_incidencia c ON c.id = i.categoria_id
               JOIN catalogo.area a ON a.id = i.area_destino_id
              WHERE i.id = $1`,
            [caso.id],
          );
          expect(fila).toEqual({ categoria: "DENUNCIA_CORRUPCION", area: "OTRANS", por: `usuario:${correo}` });
        }
      });
    });

    it("corregir a corrupción sin permiso: un caso ya revisado (403) o inexistente (404) no cambia ni revela nada", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const revisada = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", establecimiento: eess });
        const { agente } = await entrar(contexto, app, [R.GESTOR], undefined, eess);
        expect((await agente.post(`/incidencias/${revisada.codigo}/corregir`).send({ categoria: "denuncia-corrupcion" })).status).toBe(403);
        expect((await agente.post("/incidencias/MINSA-2026-999999/corregir").send({ categoria: "denuncia-corrupcion" })).status).toBe(404);
        expect((await agente.get(`/incidencias/${revisada.codigo}`)).body.categoria).toBe("reclamo");
      });
    });

    it("corregir a la misma categoría responde 422 y no registra nada", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: eess });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR], undefined, eess);
        const res = await agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "reclamo" });
        expect(res.status).toBe(422);
        expect(res.body.errorCode).toBe("UNPROCESSABLE");
        expect(await accionesDe(agente, caso.codigo)).toEqual(["confirmar", "corregir", "archivar"]);
      });
    });

    it("el administrador sí corrige a corrupción: el caso pasa a OTRANS, sale del establecimiento y OTRANS lo ve", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: eess });
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const delArea = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        expect((await delArea.agente.get(`/incidencias/${caso.codigo}`)).status).toBe(200);

        const res = await admin.agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "denuncia-corrupcion" });
        expect(res.status).toBe(200);
        expect(res.body.caso).toMatchObject({ categoria: "denuncia-corrupcion", area: { codigo: "OTRANS", nombre: "OTRANS" }, corregida: true });

        expect((await delArea.agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
        expect(await accionesDe(otrans.agente, caso.codigo)).toEqual(["derivar", "tomar", "archivar"]);
      });
    });

    it("OTRANS corrige a queja: sale de su vista, vuelve al establecimiento de origen y su responsable la toma directo", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess });
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const delArea = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);

        const res = await otrans.agente.post(`/incidencias/${caso.codigo}/corregir`).send({ categoria: "queja" });
        expect(res.status).toBe(200);
        expect(res.body.caso).toBeNull();
        expect(res.body.mensaje).toContain("Queja");
        expect(res.body.mensaje).toContain("ya no aparece");
        expect((await otrans.agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
        expect(await accionesDe(delArea.agente, caso.codigo)).toEqual(["tomar", "archivar"]);

        const tomada = await delArea.agente.post(`/incidencias/${caso.codigo}/tomar`);
        expect(tomada.status).toBe(200);
        expect(tomada.body.caso).toMatchObject({ estado: "en-gestion", categoria: "queja", area: { codigo: eess.areaCodigo } });
      });
    });

    it("derivar: el administrador lo manda por defecto al área del establecimiento de origen y la base firma la derivación", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: eess });
        const { agente, correo } = await entrar(contexto, app, [R.ADMINISTRADOR], "Ada Admin");
        const res = await agente.post(`/incidencias/${caso.codigo}/derivar`);
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Caso derivado al área.");
        expect(res.body.caso).toMatchObject({
          estado: "derivado",
          responsable: "Ada Admin",
          acciones: ["archivar"],
          area: { codigo: eess.areaCodigo, nombre: eess.areaNombre },
        });

        const [fila] = await contexto.database.query<{ area_destino_id: number; derivado_por: string; derivado_en: Date | null }>(
          "SELECT area_destino_id, derivado_por, derivado_en FROM chatbot.incidencia_paciente WHERE id = $1",
          [caso.id],
        );
        expect(fila).toMatchObject({ area_destino_id: eess.areaId, derivado_por: `usuario:${correo}` });
        expect(fila?.derivado_en).toBeInstanceOf(Date);

        const delArea = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        expect(await accionesDe(delArea.agente, caso.codigo)).toEqual(["tomar", "resolver", "archivar"]);
      });
    });

    it("derivar con areaDestino lo envía a ese establecimiento aunque el origen sea otro, y el de origen deja de verlo", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const origen = await crearEstablecimientoDePrueba(contexto);
        const destino = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", establecimiento: origen });
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);

        const res = await admin.agente.post(`/incidencias/${caso.codigo}/derivar`).send({ areaDestino: destino.areaCodigo });
        expect(res.status).toBe(200);
        expect(res.body.caso.area).toEqual({ codigo: destino.areaCodigo, nombre: destino.areaNombre });
        expect(res.body.caso.establecimiento).toEqual({ codigoRenipress: origen.codigoRenipress, nombre: origen.nombre, nivelAtencion: null, categoria: null });

        expect((await (await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, destino)).agente.get(`/incidencias/${caso.codigo}`)).status).toBe(200);
        expect((await (await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, origen)).agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
        expect((await (await entrar(contexto, app, [R.GESTOR], undefined, origen)).agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
      });
    });

    it("derivar un caso sin establecimiento de origen y sin areaDestino responde 422 y deja el caso como estaba", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada" });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

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
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

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
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const res = await agente.post(`/incidencias/${caso.codigo}/derivar`);
        expect(res.status).toBe(422);
      });
    });

    it("derivar sin revisión, ya derivado o por el responsable del establecimiento (que no deriva) responde 403", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const sinRevisar = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess });
        const revisada = await sembrarCaso(contexto, { categoria: C.OTRO, revision: "confirmada", establecimiento: eess });
        const yaDerivada = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: eess });
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const gestor = await entrar(contexto, app, [R.GESTOR], undefined, eess);
        const area = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);

        // El gestor deriva solo lo ya revisado y en clasificado; sin revisar o ya derivado, 403.
        expect((await gestor.agente.post(`/incidencias/${sinRevisar.codigo}/derivar`)).status).toBe(403);
        expect((await gestor.agente.post(`/incidencias/${yaDerivada.codigo}/derivar`)).status).toBe(403);

        const sinRevisarRes = await admin.agente.post(`/incidencias/${sinRevisar.codigo}/derivar`);
        expect(sinRevisarRes.status).toBe(403);
        expect(sinRevisarRes.body.errorCode).toBe("FORBIDDEN");
        expect((await admin.agente.post(`/incidencias/${yaDerivada.codigo}/derivar`)).status).toBe(403);
        expect((await area.agente.post(`/incidencias/${revisada.codigo}/derivar`)).status).toBe(403);
        expect((await area.agente.post(`/incidencias/${revisada.codigo}/derivar`).send({ areaDestino: eess.areaCodigo })).status).toBe(403);
        expect((await admin.agente.get(`/incidencias/${revisada.codigo}`)).body.estado).toBe("clasificado");
      });
    });

    it("derivar por el gestor: manda un caso revisado a OTRO establecimiento y deja de verlo; un destino que no es establecimiento responde 422", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const origen = await crearEstablecimientoDePrueba(contexto);
        const destino = await crearEstablecimientoDePrueba(contexto);
        const gestor = await entrar(contexto, app, [R.GESTOR], undefined, origen);
        const delDestino = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, destino);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: origen });

        // OTRANS no es un establecimiento: 422 con código estable y el caso no cambia.
        const aOtrans = await gestor.agente.post(`/incidencias/${caso.codigo}/derivar`).send({ areaDestino: "OTRANS" });
        expect(aOtrans.status).toBe(422);
        expect(aOtrans.body.errorCode).toBe("UNPROCESSABLE");
        expect((await gestor.agente.get(`/incidencias/${caso.codigo}`)).body.estado).toBe("clasificado");

        const res = await gestor.agente.post(`/incidencias/${caso.codigo}/derivar`).send({ areaDestino: destino.areaCodigo });
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Caso derivado al área.");
        expect((await gestor.agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
        expect(await accionesDe(delDestino.agente, caso.codigo)).toEqual(["tomar", "resolver", "archivar"]);
      });
    });

    it("el gestor puede listar los establecimientos destino (GET /areas) aunque su vista de casos siga siendo la de su área", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const origen = await crearEstablecimientoDePrueba(contexto);
        const destino = await crearEstablecimientoDePrueba(contexto);
        const gestor = await entrar(contexto, app, [R.GESTOR], undefined, origen);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: destino });
        const areas = await gestor.agente.get("/areas").query({ tipo: "ESTABLECIMIENTO", q: destino.nombre });
        expect((areas.body.items as { codigo: string }[]).map((a) => a.codigo)).toContain(destino.areaCodigo);
        expect((await gestor.agente.get(`/incidencias/${caso.codigo}`)).status).toBe(404);
      });
    });

    it("una denuncia por corrupción: el establecimiento no la ve (404); OTRANS la deriva en su misma área y nunca a un establecimiento (422)", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", establecimiento: eess });
        const delArea = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        const gestor = await entrar(contexto, app, [R.GESTOR], undefined, eess);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);

        for (const quien of [delArea, gestor]) {
          expect((await quien.agente.post(`/incidencias/${corrupcion.codigo}/derivar`).send({ areaDestino: eess.areaCodigo })).status).toBe(404);
        }
        for (const quien of [otrans, admin]) {
          const aUnEstablecimiento = await quien.agente.post(`/incidencias/${corrupcion.codigo}/derivar`).send({ areaDestino: eess.areaCodigo });
          expect(aUnEstablecimiento.status).toBe(422);
          expect(aUnEstablecimiento.body.errorCode).toBe("UNPROCESSABLE");
        }
        expect((await otrans.agente.get(`/incidencias/${corrupcion.codigo}`)).body.estado).toBe("clasificado");

        const res = await otrans.agente.post(`/incidencias/${corrupcion.codigo}/derivar`);
        expect(res.status).toBe(200);
        expect(res.body.caso).toMatchObject({ estado: "derivado", area: { codigo: "OTRANS" }, acciones: ["tomar", "resolver", "archivar"] });
      });
    });

    describe("invariante: la corrupción nunca queda en un establecimiento", () => {
      it("el establecimiento y el gestor nunca obtienen un caso de corrupción: lista, detalle, campana y todas las acciones responden como si no existiera", async () => {
        await usar(async (contexto) => {
          const app = construir(contexto);
          const eess = await crearEstablecimientoDePrueba(contexto);
          const marcador = marcaDePrueba();
          const base = { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess, marcador };
          const casos = [
            await sembrarCaso(contexto, { ...base, edadHoras: 80 }),
            await sembrarCaso(contexto, { ...base, revision: "confirmada" }),
            await sembrarCaso(contexto, { ...base, revision: "confirmada", estado: "DERIVADO" }),
            await sembrarCaso(contexto, { ...base, revision: "confirmada", estado: "EN_GESTION" }),
            await sembrarCaso(contexto, { ...base, estado: "RESUELTO" }),
            await sembrarCaso(contexto, { ...base, archivar: { motivo: "NO_CORRESPONDE" } }),
          ];
          const cuerpos: Record<string, object> = {
            confirmar: {}, corregir: { categoria: "queja" }, derivar: { areaDestino: eess.areaCodigo }, tomar: {},
            resolver: RESOLUCION_VALIDA, archivar: ARCHIVO_VALIDO, reabrir: REAPERTURA_VALIDA,
          };
          for (const rol of [R.ESTABLECIMIENTO, R.GESTOR]) {
            const { agente } = await entrar(contexto, app, [rol], undefined, eess);
            expect(await codigosVistos(agente, marcador)).toEqual([]);
            const campana = (await agente.get("/incidencias/por-vencer")).body as { casos: CasoDto[] };
            expect(campana.casos.map((c) => c.codigo).filter((codigo) => casos.some((c) => c.codigo === codigo))).toEqual([]);
            for (const caso of casos) {
              expect((await agente.get(`/incidencias/${caso.codigo}`)).status, `${rol} detalle`).toBe(404);
              for (const [accion, cuerpo] of Object.entries(cuerpos)) {
                expect((await agente.post(`/incidencias/${caso.codigo}/${accion}`).send(cuerpo)).status, `${rol} ${accion}`).toBe(404);
              }
            }
          }
        });
      });
    });

    it("tomar: el establecimiento toma lo derivado a su área y lo revisado de su área directo; otro establecimiento no lo ve; OTRANS toma directo", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: a });
        const directa = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", establecimiento: a });
        const sinRevisar = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: a });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", establecimiento: a });
        const delA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
        const delB = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, b);
        const otrans = await entrar(contexto, app, [R.OTRANS]);

        expect((await delB.agente.post(`/incidencias/${queja.codigo}/tomar`)).status).toBe(404);
        expect((await delA.agente.post(`/incidencias/${corrupcion.codigo}/tomar`)).status).toBe(404);
        expect((await delA.agente.post(`/incidencias/${sinRevisar.codigo}/tomar`)).status).toBe(403);
        const tomada = await delA.agente.post(`/incidencias/${queja.codigo}/tomar`);
        expect(tomada.status).toBe(200);
        expect(tomada.body.mensaje).toBe("Caso tomado en gestión.");
        expect(tomada.body.caso).toMatchObject({ estado: "en-gestion", acciones: ["resolver", "archivar"] });

        const [marca] = await contexto.database.query<{ tomado_por: string | null; tomado_en: Date | null }>(
          "SELECT tomado_por, tomado_en FROM chatbot.incidencia_paciente WHERE id = $1",
          [queja.id],
        );
        expect(marca?.tomado_por).toMatch(/^usuario:/);
        expect(marca?.tomado_en).toBeInstanceOf(Date);

        const sinDerivar = await delA.agente.post(`/incidencias/${directa.codigo}/tomar`);
        expect(sinDerivar.status).toBe(200);
        expect(sinDerivar.body.caso).toMatchObject({ estado: "en-gestion", categoria: "reclamo" });

        const deCorrupcion = await otrans.agente.post(`/incidencias/${corrupcion.codigo}/tomar`);
        expect(deCorrupcion.status).toBe(200);
        expect(deCorrupcion.body.caso).toMatchObject({ estado: "en-gestion", categoria: "denuncia-corrupcion" });
        const [fila] = await contexto.database.query<{ estado: string }>(
          "SELECT e.codigo AS estado FROM chatbot.incidencia_paciente i JOIN catalogo.estado_incidencia e ON e.id = i.estado_incidencia_id WHERE i.id = $1",
          [corrupcion.id],
        );
        expect(fila?.estado).toBe("EN_GESTION");
      });
    });

    describe("resolver", () => {
      it("exige las medidas, el fundamento y el resultado; la base pone RESUELTO y firma; la resolución se registra una sola vez", async () => {
        await usar(async (contexto) => {
          const eess = await crearEstablecimientoDePrueba(contexto);
          const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION", establecimiento: eess });
          const { agente, correo } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], undefined, eess);
          const resolver = (cuerpo: object) => agente.post(`/incidencias/${caso.codigo}/resolver`).send(cuerpo);

          expect((await resolver({})).status).toBe(400);
          expect((await resolver({ resolucion: "Se corrigió el horario." })).status).toBe(400);
          expect((await resolver({ ...RESOLUCION_VALIDA, fundamento: "  corto  " })).status).toBe(400);
          expect((await resolver({ ...RESOLUCION_VALIDA, medidasTomadas: "          " })).status).toBe(400);
          expect((await resolver({ ...RESOLUCION_VALIDA, resultado: "ARCHIVADO" })).status).toBe(400);
          expect((await agente.get(`/incidencias/${caso.codigo}`)).body.estado).toBe("en-gestion");

          const res = await resolver(RESOLUCION_VALIDA);
          expect(res.status).toBe(200);
          expect(res.body.mensaje).toBe("Caso resuelto.");
          expect(res.body.caso).toMatchObject({
            estado: "resuelto",
            resolucion: { medidasTomadas: RESOLUCION_VALIDA.medidasTomadas, fundamento: RESOLUCION_VALIDA.fundamento, resultado: "ATENDIDO" },
            horasDesdeResolucion: 0,
            acciones: [],
          });
          expect(res.body.caso.plazo).toMatchObject({ tipo: "vigencia", estado: "en-plazo" });

          const [fila] = await contexto.database.query<{ resuelto_por: string; medidas_tomadas: string; fundamento: string; resultado: string }>(
            `SELECT i.resuelto_por, i.medidas_tomadas, i.fundamento, r.codigo AS resultado
               FROM chatbot.incidencia_paciente i JOIN catalogo.resultado_resolucion r ON r.id = i.resultado_resolucion_id
              WHERE i.id = $1`,
            [caso.id],
          );
          expect(fila).toEqual({
            resuelto_por: `usuario:${correo}`,
            medidas_tomadas: RESOLUCION_VALIDA.medidasTomadas,
            fundamento: RESOLUCION_VALIDA.fundamento,
            resultado: "ATENDIDO",
          });
          expect((await resolver(RESOLUCION_VALIDA)).status).toBe(403);
        });
      });

      it("el resultado CERRADO también vale y se resuelve directo desde derivado", async () => {
        await usar(async (contexto) => {
          const eess = await crearEstablecimientoDePrueba(contexto);
          const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", establecimiento: eess });
          const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR], undefined, eess);
          const res = await agente.post(`/incidencias/${caso.codigo}/resolver`).send({ ...RESOLUCION_VALIDA, resultado: "CERRADO" });
          expect(res.status).toBe(200);
          expect(res.body.caso).toMatchObject({ estado: "resuelto", resolucion: { resultado: "CERRADO" } });
        });
      });

      it("OTRANS resuelve su corrupción; el administrador no resuelve nada (403)", async () => {
        await usar(async (contexto) => {
          const app = construir(contexto);
          const eess = await crearEstablecimientoDePrueba(contexto);
          const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", estado: "EN_GESTION", establecimiento: eess });
          const otrans = await entrar(contexto, app, [R.OTRANS]);
          const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
          expect((await admin.agente.post(`/incidencias/${corrupcion.codigo}/resolver`).send(RESOLUCION_VALIDA)).status).toBe(403);
          const res = await otrans.agente.post(`/incidencias/${corrupcion.codigo}/resolver`).send(RESOLUCION_VALIDA);
          expect(res.status).toBe(200);
          expect(res.body.caso.estado).toBe("resuelto");
        });
      });
    });

    describe("archivar", () => {
      it("el establecimiento archiva a mano desde clasificado, derivado y en gestión; la base firma quién, cuándo y por qué", async () => {
        await usar(async (contexto) => {
          const eess = await crearEstablecimientoDePrueba(contexto);
          const app = construir(contexto);
          const { agente, correo } = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
          const desde: [string, OpcionesCaso][] = [
            ["clasificado", { categoria: C.QUEJA }],
            ["derivado", { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO" }],
            ["en gestión", { categoria: C.OTRO, revision: "confirmada", estado: "EN_GESTION" }],
          ];
          for (const [nombre, opciones] of desde) {
            const caso = await sembrarCaso(contexto, { ...opciones, establecimiento: eess });
            const res = await agente.post(`/incidencias/${caso.codigo}/archivar`).send({ motivo: "DATOS_INSUFICIENTES", detalle: `  Faltan datos (${nombre}).  ` });
            expect(res.status, nombre).toBe(200);
            expect(res.body.mensaje).toBe("Caso archivado.");
            expect(res.body.caso).toMatchObject({
              estado: "archivado",
              acciones: ["reabrir"],
              archivo: { motivo: "DATOS_INSUFICIENTES", detalle: `Faltan datos (${nombre}).` },
              plazo: { tipo: null, estado: null, venceEn: null, horasRestantes: null },
            });
            const [fila] = await contexto.database.query<{ archivado_en: Date | null; cuantos: string }>(
              `SELECT i.archivado_en,
                      (SELECT count(*) FROM chatbot.incidencia_paciente_auditoria a
                        WHERE a.incidencia_paciente_id = i.id AND a.actor = $2 AND a.cambios ? 'archivo_detalle' AND a.cambios ? 'motivo_archivo_id')::text AS cuantos
                 FROM chatbot.incidencia_paciente i WHERE i.id = $1`,
              [caso.id, `usuario:${correo}`],
            );
            expect(fila?.archivado_en).toBeInstanceOf(Date);
            expect(fila?.cuantos).toBe("1");
          }
        });
      });

      it("sin detalle suficiente responde 400, y un caso resuelto, ya archivado o de otra categoría no se archiva (403 o 404)", async () => {
        await usar(async (contexto) => {
          const app = construir(contexto);
          const eess = await crearEstablecimientoDePrueba(contexto);
          const clasificado = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess });
          const resuelto = await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "RESUELTO", establecimiento: eess });
          const archivado = await sembrarCaso(contexto, { categoria: C.QUEJA, archivar: { motivo: "NO_CORRESPONDE" }, establecimiento: eess });
          const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess });
          const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
          const archivar = (codigo: string, cuerpo: object) => agente.post(`/incidencias/${codigo}/archivar`).send(cuerpo);

          for (const cuerpo of [{}, { motivo: "NO_CORRESPONDE" }, { motivo: "NO_CORRESPONDE", detalle: "         " }, { motivo: "NO_CORRESPONDE", detalle: "corto" }]) {
            const res = await archivar(clasificado.codigo, cuerpo);
            expect(res.status).toBe(400);
            expect(res.body.errorCode).toBe("VALIDATION_FAILED");
          }
          expect((await archivar(clasificado.codigo, { motivo: "VENCIDA_SIN_ATENDER", detalle: "No lo elige una persona." })).status).toBe(400);
          expect((await agente.get(`/incidencias/${clasificado.codigo}`)).body.estado).toBe("clasificado");

          expect((await archivar(resuelto.codigo, ARCHIVO_VALIDO)).status).toBe(403);
          expect((await archivar(archivado.codigo, ARCHIVO_VALIDO)).status).toBe(403);
          expect((await archivar(corrupcion.codigo, ARCHIVO_VALIDO)).status).toBe(404);
        });
      });

      it("el caso archivado a mano sale del entrenamiento (apto_entrenamiento = false) y al reabrirlo vuelve a entrar", async () => {
        await usar(async (contexto) => {
          const eess = await crearEstablecimientoDePrueba(contexto);
          const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess });
          const { agente } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], undefined, eess);
          const apto = async () =>
            (await contexto.database.query<{ apto: boolean }>("SELECT apto_entrenamiento AS apto FROM ia.entrenamiento_categoria WHERE incidencia_paciente_id = $1", [caso.id])).map((f) => f.apto);

          expect((await agente.post(`/incidencias/${caso.codigo}/confirmar`)).status).toBe(200);
          expect(await apto()).toEqual([true]);

          expect((await agente.post(`/incidencias/${caso.codigo}/archivar`).send({ motivo: "NO_CORRESPONDE", detalle: "No es de este establecimiento." })).status).toBe(200);
          expect(await apto()).toEqual([false]);

          expect((await agente.post(`/incidencias/${caso.codigo}/reabrir`).send(REAPERTURA_VALIDA)).status).toBe(200);
          expect(await apto()).toEqual([true]);
        });
      });

      it("archivar un caso ya revisado por datos insuficientes también lo saca del entrenamiento", async () => {
        await usar(async (contexto) => {
          const eess = await crearEstablecimientoDePrueba(contexto);
          const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", establecimiento: eess });
          const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR], undefined, eess);
          await agente.post(`/incidencias/${caso.codigo}/archivar`).send({ motivo: "DATOS_INSUFICIENTES", detalle: "Faltan los datos de contacto." });
          const filas = await contexto.database.query<{ apto: boolean }>(
            "SELECT apto_entrenamiento AS apto FROM ia.entrenamiento_categoria WHERE incidencia_paciente_id = $1",
            [caso.id],
          );
          expect(filas).toEqual([{ apto: false }]);
        });
      });

      it("el administrador y OTRANS también archivan, cada uno lo suyo", async () => {
        await usar(async (contexto) => {
          const app = construir(contexto);
          const eess = await crearEstablecimientoDePrueba(contexto);
          const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess });
          const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess });
          const otraCorrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess });
          const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
          const otrans = await entrar(contexto, app, [R.OTRANS]);

          expect((await otrans.agente.post(`/incidencias/${queja.codigo}/archivar`).send(ARCHIVO_VALIDO)).status).toBe(404);
          expect((await otrans.agente.post(`/incidencias/${corrupcion.codigo}/archivar`).send(ARCHIVO_VALIDO)).status).toBe(200);
          expect((await admin.agente.post(`/incidencias/${queja.codigo}/archivar`).send(ARCHIVO_VALIDO)).status).toBe(200);
          expect((await admin.agente.post(`/incidencias/${otraCorrupcion.codigo}/archivar`).send(ARCHIVO_VALIDO)).status).toBe(200);
        });
      });
    });

    describe("reabrir", () => {
      it("vuelve a en gestión con el motivo; la base limpia el archivo y registra quién, cuándo y por qué se reabrió", async () => {
        await usar(async (contexto) => {
          const eess = await crearEstablecimientoDePrueba(contexto);
          const caso = await sembrarCaso(contexto, {
            categoria: C.QUEJA, establecimiento: eess, archivar: { desde: "DERIVADO", motivo: "NO_CORRESPONDE", detalle: "No es de este establecimiento." },
          });
          const { agente, correo } = await entrar(contexto, construir(contexto), [R.GESTOR], "Gina Gestora", eess);

          for (const cuerpo of [{}, { motivo: "corto" }, { motivo: "          " }]) {
            expect((await agente.post(`/incidencias/${caso.codigo}/reabrir`).send(cuerpo)).status).toBe(400);
          }
          expect((await agente.get(`/incidencias/${caso.codigo}`)).body.estado).toBe("archivado");

          const res = await agente.post(`/incidencias/${caso.codigo}/reabrir`).send(REAPERTURA_VALIDA);
          expect(res.status).toBe(200);
          expect(res.body.mensaje).toBe("Caso reabierto. Quedó en gestión.");
          expect(res.body.caso).toMatchObject({ estado: "en-gestion", archivo: null, reapertura: REAPERTURA_VALIDA, acciones: ["resolver", "archivar"] });

          const [fila] = await contexto.database.query<{
            reabierto_por: string; tomado_por: string; archivado_en: Date | null; archivo_detalle: string | null; motivo: string | null;
          }>(
            `SELECT reabierto_por, tomado_por, archivado_en, archivo_detalle, (SELECT m.codigo FROM catalogo.motivo_archivo m WHERE m.id = motivo_archivo_id) AS motivo
               FROM chatbot.incidencia_paciente WHERE id = $1`,
            [caso.id],
          );
          expect(fila).toEqual({ reabierto_por: `usuario:${correo}`, tomado_por: `usuario:${correo}`, archivado_en: null, archivo_detalle: null, motivo: null });

          const historial = (await agente.get(`/incidencias/${caso.codigo}`)).body.historial as { titulo: string; detalle: string }[];
          expect(historial.map((h) => h.titulo)).toEqual(["Recibido por WhatsApp", "La IA clasificó el caso", "Derivado al área", "Archivado", "Caso reabierto"]);
          expect(historial.at(-1)?.detalle).toBe("Por Gina Gestora.");
        });
      });

      it("se reabren los archivados por no corresponde, por datos insuficientes y por vencimiento sin atender", async () => {
        await usar(async (contexto) => {
          const eess = await crearEstablecimientoDePrueba(contexto);
          const { agente } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], undefined, eess);
          for (const motivo of ["NO_CORRESPONDE", "DATOS_INSUFICIENTES", "VENCIDA_SIN_ATENDER"] as const) {
            const caso = await sembrarCaso(contexto, { categoria: C.RECLAMO, establecimiento: eess, archivar: { desde: "DERIVADO", motivo } });
            const res = await agente.post(`/incidencias/${caso.codigo}/reabrir`).send(REAPERTURA_VALIDA);
            expect(res.status, motivo).toBe(200);
            expect(res.body.caso.estado).toBe("en-gestion");
          }
        });
      });

      it("un archivado por la vigencia de su resolución no se reabre: 409 y el caso no cambia", async () => {
        await usar(async (contexto) => {
          const app = construir(contexto);
          const eess = await crearEstablecimientoDePrueba(contexto);
          const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "ARCHIVADO", establecimiento: eess });
          const delArea = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
          const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);

          for (const quien of [delArea, admin]) {
            const res = await quien.agente.post(`/incidencias/${caso.codigo}/reabrir`).send(REAPERTURA_VALIDA);
            expect(res.status).toBe(409);
            expect(res.body.errorCode).toBe("CONFLICT");
            expect(res.body.message).not.toContain("incidencia_paciente");
          }
          const detalle = (await delArea.agente.get(`/incidencias/${caso.codigo}`)).body;
          expect(detalle).toMatchObject({ estado: "archivado", archivo: { motivo: "RESUELTA_VIGENCIA" }, reapertura: null });
        });
      });

      it("un caso que no está archivado responde 403, y uno de otra área o de otra categoría, 404", async () => {
        await usar(async (contexto) => {
          const app = construir(contexto);
          const a = await crearEstablecimientoDePrueba(contexto);
          const b = await crearEstablecimientoDePrueba(contexto);
          const abierto = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: a });
          const resuelto = await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "RESUELTO", establecimiento: a });
          const deB = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: b, archivar: { motivo: "NO_CORRESPONDE" } });
          const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: a, archivar: { motivo: "NO_CORRESPONDE" } });
          const delA = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, a);
          const reabrir = (codigo: string) => delA.agente.post(`/incidencias/${codigo}/reabrir`).send(REAPERTURA_VALIDA);

          expect((await reabrir(abierto.codigo)).status).toBe(403);
          expect((await reabrir(resuelto.codigo)).status).toBe(403);
          expect((await reabrir(deB.codigo)).status).toBe(404);
          expect((await reabrir(corrupcion.codigo)).status).toBe(404);
        });
      });

      it("el administrador y OTRANS también reabren, cada uno lo suyo", async () => {
        await usar(async (contexto) => {
          const app = construir(contexto);
          const eess = await crearEstablecimientoDePrueba(contexto);
          const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess, archivar: { motivo: "NO_CORRESPONDE" } });
          const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess, archivar: { motivo: "DATOS_INSUFICIENTES" } });
          const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
          const otrans = await entrar(contexto, app, [R.OTRANS]);

          expect((await otrans.agente.post(`/incidencias/${queja.codigo}/reabrir`).send(REAPERTURA_VALIDA)).status).toBe(404);
          expect((await otrans.agente.post(`/incidencias/${corrupcion.codigo}/reabrir`).send(REAPERTURA_VALIDA)).status).toBe(200);
          expect((await admin.agente.post(`/incidencias/${queja.codigo}/reabrir`).send(REAPERTURA_VALIDA)).status).toBe(200);
        });
      });
    });

    it("el administrador revisa, deriva, archiva y reabre, pero no toma ni resuelve (403)", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const sinRevisar = await sembrarCaso(contexto, { categoria: C.QUEJA, establecimiento: eess });
        const derivado = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", establecimiento: eess });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

        expect((await agente.post(`/incidencias/${sinRevisar.codigo}/tomar`)).status).toBe(403);
        expect((await agente.post(`/incidencias/${derivado.codigo}/tomar`)).status).toBe(403);
        expect((await agente.post(`/incidencias/${derivado.codigo}/resolver`).send(RESOLUCION_VALIDA)).status).toBe(403);

        expect((await agente.post(`/incidencias/${sinRevisar.codigo}/confirmar`)).status).toBe(200);
        expect((await agente.post(`/incidencias/${derivado.codigo}/archivar`).send(ARCHIVO_VALIDO)).status).toBe(200);
        expect((await agente.post(`/incidencias/${derivado.codigo}/reabrir`).send(REAPERTURA_VALIDA)).status).toBe(200);
      });
    });

    it("las reglas de áreas y de archivo de la base se traducen a un error claro, no a un 500", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", establecimiento: eess });
        const sinOrigen = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada" });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, establecimiento: eess });
        const repositorio = new IncidenciaRepository(contexto.database);
        const traducido = (trabajo: (tx: DbExecutor) => Promise<unknown>) =>
          contexto.database.transaction("usuario:prueba@minsa.gob.pe", trabajo).catch((e: unknown) => traducirErrorDeBase(e));

        // Derivar exige un área de destino.
        expect(await traducido((tx) => repositorio.cambiarEstado(tx, sinOrigen.id, EstadoIncidencia.DERIVADO))).toMatchObject({
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
        // Un caso abierto no se archiva por vencimiento si no lo hace el sistema.
        expect(
          await traducido((tx) =>
            tx.query(
              "UPDATE chatbot.incidencia_paciente SET estado_incidencia_id = 7, motivo_archivo_id = (SELECT id FROM catalogo.motivo_archivo WHERE codigo = 'VENCIDA_SIN_ATENDER') WHERE id = $1",
              [queja.id],
            ),
          ),
        ).toMatchObject({ statusCode: 409, message: "Un caso abierto solo se archiva cuando vence su plazo de atención." });
        // Un archivo manual sin justificación suficiente.
        expect(await traducido((tx) => repositorio.archivar(tx, queja.id, { motivo: "NO_CORRESPONDE", detalle: "corto" }))).toMatchObject({
          statusCode: 422,
          message: "Para archivar el caso hay que explicar el motivo con 10 caracteres o más.",
        });
        // Una resolución sin fundamento suficiente.
        await traducido((tx) => repositorio.cambiarEstado(tx, queja.id, EstadoIncidencia.EN_GESTION));
        expect(
          await traducido((tx) => repositorio.resolver(tx, queja.id, { medidasTomadas: "Se atendió el caso", fundamento: "corto", resultado: "ATENDIDO" })),
        ).toMatchObject({ statusCode: 422 });
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
        const gestor = await entrar(contexto, app, [R.GESTOR], "Gina Gestora", eess);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR], "Ada Admin");
        await gestor.agente.post(`/incidencias/${caso.codigo}/confirmar`);
        await admin.agente.post(`/incidencias/${caso.codigo}/derivar`);
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
        expect(historial[3]?.detalle).toBe("Por Ada Admin.");
        expect(historial[4]?.detalle).toBe("Por Aldo Área.");
        expect(res.body.responsable).toBe("Ada Admin");
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
        const ana = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Ana Corrige", undefined, eess.areaCodigo);
        const beto = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Beto Deriva", undefined, eess.areaCodigo);
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

  describe("plazo de un caso reabierto (cuenta desde la última reapertura)", () => {
    /** Reabre por la API y luego retrasa la reapertura, como si hubiera ocurrido hace `horas`. */
    async function reabrirHaceHoras(contexto: RollbackContext, agente: AgentePrueba, caso: { id: string; codigo: string }, horas: number) {
      expect((await agente.post(`/incidencias/${caso.codigo}/reabrir`).send(REAPERTURA_VALIDA)).status).toBe(200);
      await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente DISABLE TRIGGER USER");
      await contexto.client.query(
        "UPDATE chatbot.incidencia_paciente SET reabierto_en = now() - make_interval(hours => $2::int, mins => 1) WHERE id = $1",
        [caso.id, horas],
      );
      await contexto.client.query("ALTER TABLE chatbot.incidencia_paciente ENABLE TRIGGER USER");
    }

    it("reabierto hace 1 día queda con ~2 días en el listado, el detalle y la campana; sin reapertura sigue contando desde la llegada", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const marcador = marcaDePrueba();
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, archivar: { motivo: "NO_CORRESPONDE" }, edadHoras: 400, establecimiento: eess, marcador });
        const sinReabrir = await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 400, establecimiento: eess, marcador });
        await reabrirHaceHoras(contexto, agente, caso, 24);

        const detalle = (await agente.get(`/incidencias/${caso.codigo}`)).body;
        expect(detalle.plazo).toMatchObject({ tipo: "atencion", estado: "en-plazo" });
        expect(detalle.plazo.horasRestantes).toBeGreaterThanOrEqual(46);
        expect(detalle.plazo.horasRestantes).toBeLessThanOrEqual(47);
        expect(new Date(detalle.plazo.venceEn).getTime() - new Date(detalle.reapertura.reabiertoEn).getTime()).toBe(72 * 3_600_000);
        // horasDesdeLlegada sigue contando desde que llegó.
        expect(detalle.horasDesdeLlegada).toBeGreaterThanOrEqual(399);

        const lista = (await agente.get("/incidencias").query({ texto: marcador, limite: "100" })).body.items as CasoDto[];
        expect((lista.find((c) => c.codigo === caso.codigo) as CasoDto).plazo).toEqual(detalle.plazo);
        expect((lista.find((c) => c.codigo === sinReabrir.codigo) as CasoDto).plazo).toMatchObject({ estado: "vencido" });

        // La campana: el reabierto aún tiene ~2 días y no figura; el que nunca se reabrió sigue vencido y sí.
        const campana = (await agente.get("/incidencias/por-vencer")).body as { casos: CasoDto[] };
        expect(campana.casos.map((c) => c.codigo)).toContain(sinReabrir.codigo);
        expect(campana.casos.map((c) => c.codigo)).not.toContain(caso.codigo);
      });
    });

    it("un caso reabierto con el plazo de llegada vencido ya no figura vencido ni cuenta como tal en la campana; reabierto hace más de 3 días vuelve a vencer", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const marcador = marcaDePrueba();
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], undefined, eess);
        const resumen = async () => (await agente.get("/incidencias/por-vencer")).body as { total: number; vencidos: number; casos: CasoDto[] };
        const antes = await resumen();

        const reciente = await sembrarCaso(contexto, { categoria: C.QUEJA, archivar: { motivo: "VENCIDA_SIN_ATENDER" }, edadHoras: 500, establecimiento: eess, marcador });
        await reabrirHaceHoras(contexto, agente, reciente, 5);
        const detalle = (await agente.get(`/incidencias/${reciente.codigo}`)).body;
        expect(detalle.plazo).toMatchObject({ tipo: "atencion", estado: "en-plazo" });
        expect(detalle.plazo.horasRestantes).toBeGreaterThanOrEqual(66);
        const conReciente = await resumen();
        expect(conReciente.total).toBe(antes.total);
        expect(conReciente.casos.map((c) => c.codigo)).not.toContain(reciente.codigo);

        const viejo = await sembrarCaso(contexto, { categoria: C.QUEJA, archivar: { motivo: "NO_CORRESPONDE" }, edadHoras: 500, establecimiento: eess, marcador });
        await reabrirHaceHoras(contexto, agente, viejo, 80);
        expect((await agente.get(`/incidencias/${viejo.codigo}`)).body.plazo).toMatchObject({ estado: "vencido" });
        const conViejo = await resumen();
        expect(conViejo.vencidos - antes.vencidos).toBe(1);
        expect(conViejo.casos.map((c) => c.codigo)).toContain(viejo.codigo);
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

    it("cuenta lo que a cada persona le toca atender y por vencer, y baja cuando se resuelve o se archiva", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const otroEess = await crearEstablecimientoDePrueba(contexto);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const gestor = await entrar(contexto, app, [R.GESTOR], undefined, eess);
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
        const vencidaC = await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 80, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION", edadHoras: 90, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "RESUELTO", edadHoras: 100, resueltoHaceHoras: 5, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "ARCHIVADO", edadHoras: 200, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, edadHoras: 61, establecimiento: eess });

        // El administrador cuenta todo lo abierto que ve.
        const admin2 = await resumen(admin.agente);
        expect(delta(admin2, antesAdmin)).toEqual({ porVencer: 3, vencidos: 2, total: 5 });
        expect(admin2.total).toBe(admin2.porVencer + admin2.vencidos);

        // El gestor y el responsable del establecimiento cuentan lo abierto de su área (nunca la corrupción); otro establecimiento, nada.
        const gestor2 = await resumen(gestor.agente);
        expect(delta(gestor2, antesGestor)).toEqual({ porVencer: 2, vencidos: 2, total: 4 });
        const eess2 = await resumen(delEess.agente);
        expect(delta(eess2, antesEess)).toEqual({ porVencer: 2, vencidos: 2, total: 4 });
        expect(delta(await resumen(delOtro.agente), antesOtro)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });
        expect(eess2.casos.every((c) => c.categoria !== "denuncia-corrupcion")).toBe(true);

        // OTRANS solo cuenta la corrupción que le toca revisar.
        expect(delta(await resumen(otrans.agente), antesOtrans)).toEqual({ porVencer: 1, vencidos: 0, total: 1 });

        // Revisar, derivar y tomar no bajan lo pendiente: el caso sigue siendo del área.
        expect((await gestor.agente.post(`/incidencias/${sinRevisarB.codigo}/confirmar`)).status).toBe(200);
        expect(delta(await resumen(gestor.agente), gestor2)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });
        expect((await admin.agente.post(`/incidencias/${sinRevisarB.codigo}/derivar`)).status).toBe(200);
        expect(delta(await resumen(delEess.agente), eess2)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });
        expect((await delEess.agente.post(`/incidencias/${sinRevisarB.codigo}/tomar`)).status).toBe(200);
        expect(delta(await resumen(delEess.agente), eess2)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });
        expect((await resumen(admin.agente)).total).toBe(admin2.total);

        // Resolver y archivar sí bajan lo pendiente, también al administrador.
        expect((await delEess.agente.post(`/incidencias/${sinRevisarB.codigo}/resolver`).send(RESOLUCION_VALIDA)).status).toBe(200);
        expect(delta(await resumen(delEess.agente), eess2)).toEqual({ porVencer: -1, vencidos: 0, total: -1 });
        expect((await resumen(admin.agente)).total).toBe(admin2.total - 1);

        expect((await delEess.agente.post(`/incidencias/${vencidaC.codigo}/archivar`).send(ARCHIVO_VALIDO)).status).toBe(200);
        expect(delta(await resumen(delEess.agente), eess2)).toEqual({ porVencer: -1, vencidos: -1, total: -2 });
        expect((await resumen(admin.agente)).total).toBe(admin2.total - 2);
        expect(delta(await resumen(delOtro.agente), antesOtro)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });
      });
    });

    it("la lista corta trae lo más urgente primero, con tope de 10, y solo lo que el rol ve", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        for (let n = 0; n < 12; n += 1) await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 50 + n, establecimiento: eess });
        await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 300 });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, edadHoras: 200, establecimiento: eess });
        const { agente } = await entrar(contexto, app, [R.GESTOR], undefined, eess);

        const res = await resumen(agente);
        expect(res.casos.length).toBe(10);
        expect(res.total).toBe(12);
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
        await sembrarCaso(contexto, { categoria: C.RECLAMO, edadHoras: 300, establecimiento: eess, archivar: { motivo: "NO_CORRESPONDE" } });
        const despues = await resumen(agente);
        expect(despues.total).toBe(antes.total);
      });
    });
  });
});
