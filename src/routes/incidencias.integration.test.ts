import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createLogger } from "@/config/logger.js";
import { traducirErrorDeBase } from "@/database/reglas-de-la-base.js";
import { CategoriaIncidencia as C } from "@/enums/categoria-incidencia.enum.js";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { IncidenciaRepository } from "@/repositories/incidencia.repository.js";
import { testEnv } from "@/test-utils/env.js";
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

async function entrar(contexto: RollbackContext, app: ReturnType<typeof construir>, roles: string[], nombre?: string) {
  const correo = await crearUsuarioDePrueba(contexto, roles, nombre);
  const agente = await iniciarSesion(app, correo);
  return { agente, correo };
}

async function codigosVistos(agente: AgentePrueba, marcador: string): Promise<string[]> {
  const res = await agente.get("/incidencias").query({ texto: marcador, tamano: "100" });
  expect(res.status).toBe(200);
  return (res.body.casos as CasoDto[]).map((c) => c.codigo).sort();
}

async function accionesDe(agente: AgentePrueba, codigo: string): Promise<string[]> {
  const res = await agente.get(`/incidencias/${codigo}`);
  expect(res.status).toBe(200);
  return res.body.acciones as string[];
}

describe.skipIf(!url)("incidencias contra PostgreSQL real", () => {
  const usar = (prueba: (contexto: RollbackContext) => Promise<void>) => withRollbackDatabase(url as string, prueba);

  describe("qué ve cada rol", () => {
    it("el administrador ve todo; el gestor no ve corrupción; cada área solo lo suyo; los roles se unen", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, marcador });
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const reclamo = await sembrarCaso(contexto, { categoria: C.RECLAMO, marcador });
        const otro = await sembrarCaso(contexto, { categoria: C.OTRO, marcador });
        const sinCategoria = await sembrarCaso(contexto, { categoria: null, marcador });
        const ordenados = (...casos: { codigo: string }[]) => casos.map((c) => c.codigo).sort();
        const app = construir(contexto);

        const vistos = async (roles: string[]) => codigosVistos((await entrar(contexto, app, roles)).agente, marcador);

        expect(await vistos([R.ADMINISTRADOR])).toEqual(ordenados(corrupcion, queja, reclamo, otro, sinCategoria));
        expect(await vistos([R.GESTOR])).toEqual(ordenados(queja, reclamo, otro, sinCategoria));
        expect(await vistos([R.AREA_DENUNCIA_CORRUPCION])).toEqual(ordenados(corrupcion));
        expect(await vistos([R.AREA_QUEJA])).toEqual(ordenados(queja));
        expect(await vistos([R.AREA_RECLAMO])).toEqual(ordenados(reclamo));
        expect(await vistos([R.GESTOR, R.AREA_DENUNCIA_CORRUPCION])).toEqual(ordenados(corrupcion, queja, reclamo, otro, sinCategoria));
        expect(await vistos([R.AREA_QUEJA, R.AREA_RECLAMO])).toEqual(ordenados(queja, reclamo));
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

    it("un caso que el rol no ve responde 404 igual que uno que no existe, y no se puede tocar", async () => {
      await usar(async (contexto) => {
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION });
        const app = construir(contexto);
        const { agente } = await entrar(contexto, app, [R.AREA_QUEJA]);

        const oculto = await agente.get(`/incidencias/${corrupcion.codigo}`);
        const inexistente = await agente.get("/incidencias/MINSA-2099-999999");
        expect(oculto.status).toBe(404);
        expect(inexistente.status).toBe(404);
        expect(oculto.body.errorCode).toBe("NOT_FOUND");
        expect(oculto.body.message).toBe(inexistente.body.message);

        for (const accion of ["confirmar", "derivar", "tomar"]) {
          expect((await agente.post(`/incidencias/${corrupcion.codigo}/${accion}`)).status).toBe(404);
        }
        const [fila] = await contexto.database.query<{ categoria_confirmada_en: Date | null }>(
          "SELECT categoria_confirmada_en FROM chatbot.incidencia_paciente WHERE id = $1",
          [corrupcion.id],
        );
        expect(fila?.categoria_confirmada_en).toBeNull();
      });
    });
  });

  describe("contrato del detalle", () => {
    it("devuelve los campos del caso, calculados en el servidor y sin datos internos", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const revisor = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Ana Prueba");
        const caso = await sembrarCaso(contexto, {
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
            "etiquetas", "evidencias", "historial", "horasDesdeLlegada", "horasDesdeResolucion", "organismo", "plazo",
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
          area: "Área de reclamos",
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
      ["gestor, caso otro revisado (sin área)", [R.GESTOR], { categoria: C.OTRO, revision: "confirmada" }, []],
      ["gestor, queja ya derivada", [R.GESTOR], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, []],
      ["administrador nunca actúa", [R.ADMINISTRADOR], { categoria: C.QUEJA }, []],
      ["corrupción, sin revisar", [R.AREA_DENUNCIA_CORRUPCION], { categoria: C.DENUNCIA_CORRUPCION }, ["confirmar", "corregir"]],
      ["corrupción, revisada: toma directo", [R.AREA_DENUNCIA_CORRUPCION], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada" }, ["tomar"]],
      ["corrupción, derivada", [R.AREA_DENUNCIA_CORRUPCION], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["corrupción, en gestión", [R.AREA_DENUNCIA_CORRUPCION], { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada", estado: "EN_GESTION" }, ["resolver"]],
      ["área de quejas, queja derivada", [R.AREA_QUEJA], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["área de quejas, queja en gestión", [R.AREA_QUEJA], { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION" }, ["resolver"]],
      ["área de quejas, queja resuelta", [R.AREA_QUEJA], { categoria: C.QUEJA, revision: "confirmada", estado: "RESUELTO" }, []],
      ["área de reclamos, reclamo derivado", [R.AREA_RECLAMO], { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["gestor y área de quejas, queja derivada", [R.GESTOR, R.AREA_QUEJA], { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" }, ["tomar", "resolver"]],
      ["gestor y área de quejas, reclamo derivado", [R.GESTOR, R.AREA_QUEJA], { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO" }, []],
    ];

    it.each(filas)("%s", async (_nombre, roles, opciones, esperadas) => {
      await usar(async (contexto) => {
        const caso = await sembrarCaso(contexto, opciones);
        const { agente } = await entrar(contexto, construir(contexto), roles);
        expect(await accionesDe(agente, caso.codigo)).toEqual(esperadas);
        const lista = await agente.get("/incidencias").query({ texto: caso.codigo });
        expect(lista.body.casos).toHaveLength(1);
        expect(lista.body.casos[0].acciones).toEqual(esperadas);
      });
    });
  });

  describe("lista: paginación, orden y filtros", () => {
    it("20 por página, lo más antiguo primero, con el total", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const casos = [];
        for (let n = 0; n < 25; n += 1) {
          casos.push(await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, edadHoras: 10 + n }));
        }
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);

        const primera = await agente.get("/incidencias").query({ texto: marcador });
        expect(primera.status).toBe(200);
        expect(primera.body).toMatchObject({ pagina: 1, tamano: 20, total: 25 });
        expect(primera.body.casos).toHaveLength(20);
        const masAntiguos = [...casos].reverse().map((c) => c.codigo);
        expect((primera.body.casos as CasoDto[]).map((c) => c.codigo)).toEqual(masAntiguos.slice(0, 20));

        const segunda = await agente.get("/incidencias").query({ texto: marcador, pagina: "2" });
        expect((segunda.body.casos as CasoDto[]).map((c) => c.codigo)).toEqual(masAntiguos.slice(20));
        expect((await agente.get("/incidencias").query({ texto: marcador, pagina: "3" })).body.casos).toEqual([]);

        const chica = await agente.get("/incidencias").query({ texto: marcador, tamano: "10", pagina: "3" });
        expect(chica.body).toMatchObject({ pagina: 3, tamano: 10, total: 25 });
        expect(chica.body.casos).toHaveLength(5);
      });
    });

    it("ordena por columna en los dos sentidos y desempata de forma estable", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const a = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, edadHoras: 30, confianza: 90 });
        const b = await sembrarCaso(contexto, { categoria: C.RECLAMO, marcador, edadHoras: 20, confianza: 40 });
        const c = await sembrarCaso(contexto, { categoria: C.OTRO, marcador, edadHoras: 10, confianza: 70 });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const orden = async (orden: string, direccion: string) =>
          ((await agente.get("/incidencias").query({ texto: marcador, orden, direccion })).body.casos as CasoDto[]).map((x) => x.codigo);

        expect(await orden("fecha", "asc")).toEqual([a.codigo, b.codigo, c.codigo]);
        expect(await orden("fecha", "desc")).toEqual([c.codigo, b.codigo, a.codigo]);
        expect(await orden("codigo", "asc")).toEqual([a.codigo, b.codigo, c.codigo]);
        expect(await orden("codigo", "desc")).toEqual([c.codigo, b.codigo, a.codigo]);
        expect(await orden("confianza", "asc")).toEqual([b.codigo, c.codigo, a.codigo]);
        expect(await orden("confianza", "desc")).toEqual([a.codigo, c.codigo, b.codigo]);
        expect(await orden("categoria", "asc")).toEqual([c.codigo, a.codigo, b.codigo]);
      });
    });

    it("filtra por estado, por categoría, por casos sin categoría y por texto", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const derivado = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "confirmada", estado: "DERIVADO", marcador });
        const sin = await sembrarCaso(contexto, { categoria: null, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const ver = async (filtros: Record<string, string>) =>
          ((await agente.get("/incidencias").query({ texto: marcador, ...filtros })).body.casos as CasoDto[]).map((x) => x.codigo).sort();

        expect(await ver({ estado: "derivado" })).toEqual([derivado.codigo]);
        expect(await ver({ estado: "registrado" })).toEqual([sin.codigo]);
        expect(await ver({ categoria: "queja" })).toEqual([queja.codigo]);
        expect(await ver({ categoria: "sin-categoria" })).toEqual([sin.codigo]);
        expect(await ver({ categoria: "reclamo", estado: "derivado" })).toEqual([derivado.codigo]);
        expect(await ver({ categoria: "queja", estado: "derivado" })).toEqual([]);

        const porCodigo = await agente.get("/incidencias").query({ texto: queja.codigo });
        expect((porCodigo.body.casos as CasoDto[]).map((x) => x.codigo)).toEqual([queja.codigo]);
        const porCodigoParcial = await agente.get("/incidencias").query({ texto: queja.codigo.toLowerCase().slice(6) });
        expect((porCodigoParcial.body.casos as CasoDto[]).map((x) => x.codigo)).toContain(queja.codigo);
      });
    });

    it("el texto se busca literal: % y _ no son comodines y las comillas no rompen la consulta", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const total = async (texto: string) => (await agente.get("/incidencias").query({ texto })).body.total as number;

        expect(await total(marcador)).toBe(1);
        expect(await total(`${marcador}%`)).toBe(0);
        expect(await total(`_${marcador.slice(1)}`)).toBe(0);
        expect(await total("'; DROP TABLE chatbot.incidencia_paciente; --")).toBe(0);
        expect(await total(marcador)).toBe(1);
      });
    });

    it("solo cuenta los casos que el rol ve en el total y la página", async () => {
      await usar(async (contexto) => {
        const marcador = marcaDePrueba();
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, marcador });
        await sembrarCaso(contexto, { categoria: C.QUEJA, marcador });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR]);
        const res = await agente.get("/incidencias").query({ texto: marcador });
        expect(res.body.total).toBe(1);
        expect(res.body.casos).toHaveLength(1);
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
        expect(res.body.caso).toMatchObject({ categoria: "queja", categoriaIa: "reclamo", corregida: true, revisadoPorHumano: true, area: "Área de quejas", acciones: ["derivar"] });

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

        const area = await entrar(contexto, app, [R.AREA_DENUNCIA_CORRUPCION]);
        expect(await accionesDe(area.agente, caso.codigo)).toEqual(["tomar"]);
      });
    });

    it("derivar: pasa a derivado y el responsable es quien derivó", async () => {
      await usar(async (contexto) => {
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada" });
        const { agente } = await entrar(contexto, construir(contexto), [R.GESTOR], "Gina Gestora");
        const res = await agente.post(`/incidencias/${caso.codigo}/derivar`);
        expect(res.status).toBe(200);
        expect(res.body.mensaje).toBe("Caso derivado al área.");
        expect(res.body.caso).toMatchObject({ estado: "derivado", responsable: "Gina Gestora", acciones: [] });
      });
    });

    it("derivar sin revisión, un caso otro o por un rol que no deriva responde 403", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const sinRevisar = await sembrarCaso(contexto, { categoria: C.QUEJA });
        const otro = await sembrarCaso(contexto, { categoria: C.OTRO, revision: "confirmada" });
        const revisada = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada" });
        const gestor = await entrar(contexto, app, [R.GESTOR]);
        const area = await entrar(contexto, app, [R.AREA_QUEJA]);

        const sinRevisarRes = await gestor.agente.post(`/incidencias/${sinRevisar.codigo}/derivar`);
        expect(sinRevisarRes.status).toBe(403);
        expect(sinRevisarRes.body.errorCode).toBe("FORBIDDEN");
        expect((await gestor.agente.post(`/incidencias/${otro.codigo}/derivar`)).status).toBe(403);
        expect((await area.agente.post(`/incidencias/${revisada.codigo}/derivar`)).status).toBe(403);
      });
    });

    it("tomar: el área toma lo derivado; otra área no lo ve; corrupción toma directo desde clasificado", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const queja = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO" });
        const corrupcion = await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, revision: "confirmada" });
        const areaQueja = await entrar(contexto, app, [R.AREA_QUEJA]);
        const areaReclamo = await entrar(contexto, app, [R.AREA_RECLAMO]);
        const areaCorrupcion = await entrar(contexto, app, [R.AREA_DENUNCIA_CORRUPCION]);

        expect((await areaReclamo.agente.post(`/incidencias/${queja.codigo}/tomar`)).status).toBe(404);
        const tomada = await areaQueja.agente.post(`/incidencias/${queja.codigo}/tomar`);
        expect(tomada.status).toBe(200);
        expect(tomada.body.mensaje).toBe("Caso tomado en gestión.");
        expect(tomada.body.caso).toMatchObject({ estado: "en-gestion", acciones: ["resolver"] });

        const directa = await areaCorrupcion.agente.post(`/incidencias/${corrupcion.codigo}/tomar`);
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
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION" });
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.AREA_QUEJA]);

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
        const caso = await sembrarCaso(contexto, { categoria: C.QUEJA, marcador, confianza: 77 });
        const gestor = await entrar(contexto, app, [R.GESTOR], "Gina Gestora");
        await gestor.agente.post(`/incidencias/${caso.codigo}/confirmar`);
        await gestor.agente.post(`/incidencias/${caso.codigo}/derivar`);
        const area = await entrar(contexto, app, [R.AREA_QUEJA], "Aldo Área");
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
        const ana = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Ana Corrige");
        const beto = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Beto Deriva");
        const corregido = await sembrarCaso(contexto, { categoria: C.RECLAMO, revision: "corregida", corregidaA: C.QUEJA, actorRevision: `usuario:${ana}` });
        const derivado = await sembrarCaso(contexto, {
          categoria: C.RECLAMO, revision: "corregida", corregidaA: C.QUEJA, actorRevision: `usuario:${ana}`,
          estado: "DERIVADO", actorDerivacion: `usuario:${beto}`,
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
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const gestor = await entrar(contexto, app, [R.GESTOR]);
        const areaQueja = await entrar(contexto, app, [R.AREA_QUEJA]);
        const antesAdmin = await resumen(admin.agente);
        const antesGestor = await resumen(gestor.agente);
        const antesArea = await resumen(areaQueja.agente);

        await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 10 });
        const sinRevisarB = await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 60 });
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "DERIVADO", edadHoras: 70 });
        await sembrarCaso(contexto, { categoria: C.QUEJA, edadHoras: 80 });
        await sembrarCaso(contexto, { categoria: C.QUEJA, revision: "confirmada", estado: "EN_GESTION", edadHoras: 90 });
        await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "RESUELTO", edadHoras: 100, resueltoHaceHoras: 5 });
        await sembrarCaso(contexto, { categoria: C.QUEJA, estado: "ARCHIVADO", edadHoras: 200 });
        await sembrarCaso(contexto, { categoria: C.DENUNCIA_CORRUPCION, edadHoras: 61 });

        const admin2 = await resumen(admin.agente);
        expect(delta(admin2, antesAdmin)).toEqual({ porVencer: 3, vencidos: 2, total: 5 });
        expect(admin2.total).toBe(admin2.porVencer + admin2.vencidos);

        const gestor2 = await resumen(gestor.agente);
        expect(delta(gestor2, antesGestor)).toEqual({ porVencer: 1, vencidos: 1, total: 2 });

        const area2 = await resumen(areaQueja.agente);
        expect(delta(area2, antesArea)).toEqual({ porVencer: 1, vencidos: 1, total: 2 });

        expect((await gestor.agente.post(`/incidencias/${sinRevisarB.codigo}/confirmar`)).status).toBe(200);
        expect(delta(await resumen(gestor.agente), gestor2)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });

        expect((await gestor.agente.post(`/incidencias/${sinRevisarB.codigo}/derivar`)).status).toBe(200);
        expect(delta(await resumen(gestor.agente), gestor2)).toEqual({ porVencer: -1, vencidos: 0, total: -1 });
        const area3 = await resumen(areaQueja.agente);
        expect(delta(area3, area2)).toEqual({ porVencer: 1, vencidos: 0, total: 1 });
        expect((await resumen(admin.agente)).total).toBe(admin2.total);

        expect((await areaQueja.agente.post(`/incidencias/${sinRevisarB.codigo}/tomar`)).status).toBe(200);
        expect(delta(await resumen(areaQueja.agente), area3)).toEqual({ porVencer: 0, vencidos: 0, total: 0 });

        expect((await areaQueja.agente.post(`/incidencias/${sinRevisarB.codigo}/resolver`).send({ resolucion: "Atendido." })).status).toBe(200);
        expect(delta(await resumen(areaQueja.agente), area3)).toEqual({ porVencer: -1, vencidos: 0, total: -1 });
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
        const { agente } = await entrar(contexto, app, [R.AREA_RECLAMO]);
        const antes = await resumen(agente);
        await sembrarCaso(contexto, { categoria: C.RECLAMO, edadHoras: 5 });
        await sembrarCaso(contexto, { categoria: C.RECLAMO, estado: "RESUELTO", edadHoras: 300, resueltoHaceHoras: 100 });
        await sembrarCaso(contexto, { categoria: C.RECLAMO, estado: "ARCHIVADO", edadHoras: 300 });
        const despues = await resumen(agente);
        expect(despues.total).toBe(antes.total);
      });
    });
  });
});
