import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CASOS_SIMILARES_MAXIMOS,
  SIMILITUD_CASI_DUPLICADO,
} from "@/constants/casos-similares.js";
import type { DbExecutor } from "@/database/database.js";
import {
  FormatoSalidaIa,
  MotivoFalloIa,
  VarianteIa,
} from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type {
  ClienteModelo,
  MetricasModelo,
  PeticionModelo,
} from "@/services/analisis-ia/analisis-ia.types.js";
import type {
  CasoSimilar,
  RecuperadorCasos,
} from "@/services/analisis-ia/casos/casos.types.js";
import {
  consultaCasosSimilares,
  crearRecuperadorPgTrgm,
  seleccionarCasos,
  type FilaDeCaso,
} from "@/services/analisis-ia/casos/recuperar-casos.js";
import {
  construirCasosParecidos,
  construirPeticion,
  PROMPT_SISTEMA,
} from "@/services/analisis-ia/prompts.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

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

const TEXTO_COBRO = "El director del hospital me pidió plata para atenderme";
const TEXTO_NEUTRO =
  "Quiero saber a qué hora abre la farmacia del hospital por las tardes";

const caso = (parcial: Partial<CasoSimilar> = {}): CasoSimilar => ({
  id: "c1",
  categoria: CategoriaIncidencia.QUEJA,
  similitud: 0.3,
  texto: "La enfermera me trató mal en la ventanilla",
  ...parcial,
});

const fila = (
  id: string,
  categoria: number,
  similitud: number,
): FilaDeCaso => ({
  id,
  categoria_final_id: categoria,
  texto: `texto de ${id}`,
  similitud,
});

/** Cliente que guarda la petición que recibe para poder inspeccionarla. */
function clienteEspia(): {
  cliente: ClienteModelo;
  peticiones: PeticionModelo[];
} {
  const peticiones: PeticionModelo[] = [];
  return {
    peticiones,
    cliente: {
      consultar: vi.fn(async (peticion: PeticionModelo) => {
        peticiones.push(peticion);
        return {
          ok: true as const,
          salida: {
            categoria: CategoriaIncidencia.QUEJA,
            peso_corrupcion: 0,
            posible_corrupcion: false,
          },
          metricas: METRICAS,
        };
      }),
    },
  };
}

const sha256 = (texto: string): string =>
  createHash("sha256").update(texto).digest("hex");

describe("V1, V2, V3 y V2C no cambian", () => {
  it("sus prompts del sistema son byte a byte los de antes de V2R", () => {
    expect(sha256(PROMPT_SISTEMA.V1)).toBe(
      "f5689423a096aabd334babe42a3a82f3d43cafb174fb5bf9bafa10986109a74f",
    );
    expect(sha256(PROMPT_SISTEMA.V2)).toBe(
      "3152469673075cb5b25b486ff6bdbbed2dedb170f8587a3f124fb83b7bdcc749",
    );
    expect(sha256(PROMPT_SISTEMA.V3)).toBe(
      "c1d418dd4f59f1e1eaa04b815c6365d2f8358c12e28dd334be57dc175c7dcfa2",
    );
    expect(sha256(PROMPT_SISTEMA.V2C)).toBe(
      "38a38e7507a5e314185131a61ed4d2bad42c7548b8298dfe4f25ef4e9843b70b",
    );
  });
});

describe("prompt de V2R", () => {
  const sistema = PROMPT_SISTEMA[VarianteIa.V2R];

  it("es el de V2C más el bloque de casos parecidos, y la salida sigue siendo compacta", () => {
    expect(sistema).toContain("CASOS PARECIDOS YA REVISADOS");
    expect(PROMPT_SISTEMA.V2C).not.toContain("CASOS PARECIDOS");
    expect(
      sistema.replace(/\n\nCASOS PARECIDOS YA REVISADOS[^\n]*\n[^\n]*/, ""),
    ).toBe(PROMPT_SISTEMA.V2C);
    for (const campo of ["informacion_faltante", "alternativas", "explicacion"])
      expect(sistema).not.toContain(campo);
  });

  it("el prefijo no varía entre mensajes ni según los casos: lo variable va en el mensaje del usuario", () => {
    const a = construirPeticion(
      VarianteIa.V2R,
      TEXTO_COBRO,
      evaluarTextoCorrupcion(TEXTO_COBRO),
      { casosSimilares: [caso()] },
    );
    const b = construirPeticion(
      VarianteIa.V2R,
      TEXTO_NEUTRO,
      evaluarTextoCorrupcion(TEXTO_NEUTRO),
    );
    expect(a.sistema).toBe(b.sistema);
    expect(a.sistema).toBe(sistema);
    expect(a.formato).toBe(FormatoSalidaIa.COMPACTA);
    expect(a.usuario).toContain("La enfermera me trató mal en la ventanilla");
    expect(sistema).not.toContain("La enfermera");
  });

  it("los casos se muestran con su categoría revisada y, sin casos, dice «ninguno»", () => {
    const con = construirCasosParecidos([
      caso({ texto: "primero" }),
      caso({
        id: "c2",
        texto: "segundo",
        categoria: CategoriaIncidencia.RECLAMO,
      }),
    ]);
    expect(con).toContain('1. "primero" -> categoría revisada: QUEJA');
    expect(con).toContain('2. "segundo" -> categoría revisada: RECLAMO');
    expect(construirCasosParecidos([])).toContain("ninguno");
  });

  it("corta los casos largos y junta los espacios", () => {
    const largo = construirCasosParecidos([
      caso({ texto: `a  b\n${"x".repeat(500)}` }),
    ]);
    expect(largo).toContain("a b ");
    expect(largo).toContain("...");
    expect(largo.length).toBeLessThan(500);
  });

  it("las demás variantes no llevan casos en el mensaje del usuario", () => {
    const reglas = evaluarTextoCorrupcion(TEXTO_COBRO);
    for (const v of [
      VarianteIa.V1,
      VarianteIa.V2,
      VarianteIa.V3,
      VarianteIa.V2C,
    ])
      expect(
        construirPeticion(v, TEXTO_COBRO, reglas, { casosSimilares: [caso()] })
          .usuario,
      ).not.toContain("Casos parecidos");
  });
});

describe("selección de casos", () => {
  it("descarta los casi duplicados (similitud de 0,5 o más), los cuenta y se queda con los mejores", () => {
    const r = seleccionarCasos([
      fila("a", 1, 0.9),
      fila("b", 2, 0.5),
      fila("c", 3, 0.49),
      fila("d", 2, 0.4),
      fila("e", 4, 0.3),
      fila("f", 2, 0.2),
    ]);
    expect(r.casiDuplicadosDescartados).toBe(2);
    expect(r.casos.map((c) => c.id)).toEqual(["c", "d", "e"]);
    expect(r.casos).toHaveLength(CASOS_SIMILARES_MAXIMOS);
    expect(r.casos.every((c) => c.similitud < SIMILITUD_CASI_DUPLICADO)).toBe(
      true,
    );
  });

  it("traduce el id de categoría del catálogo, ignora los ids desconocidos y redondea la similitud", () => {
    const r = seleccionarCasos([fila("a", 99, 0.4), fila("b", 3, 0.30000001)]);
    expect(r.casos).toEqual([
      { id: "b", categoria: "RECLAMO", similitud: 0.3, texto: "texto de b" },
    ]);
  });

  it("sin filas no hay casos", () => {
    expect(seleccionarCasos([])).toEqual({
      casos: [],
      casiDuplicadosDescartados: 0,
    });
  });
});

describe("recuperador con pg_trgm (base simulada)", () => {
  it("la consulta solo lee, usa similarity sobre unaccent y rechaza relaciones raras", () => {
    const sql = consultaCasosSimilares("ia.entrenamiento_categoria");
    expect(sql).toMatch(/^SELECT /);
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|CREATE|DROP/i);
    expect(sql).toContain(
      "similarity(unaccent(texto_entrenamiento), unaccent($1))",
    );
    expect(sql).toContain("apto_entrenamiento");
    expect(() => consultaCasosSimilares("ia.x; DROP TABLE y")).toThrow();
    expect(() => consultaCasosSimilares("x y")).toThrow();
  });

  it("pasa el texto, el mínimo y el tope como parámetros y devuelve los casos", async () => {
    const query = vi.fn(async () => [fila("a", 2, 0.42), fila("b", 1, 0.7)]);
    const recuperar = crearRecuperadorPgTrgm({
      query,
    } as unknown as DbExecutor);
    const r = await recuperar("un texto");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toEqual([
      expect.stringContaining("FROM ia.entrenamiento_categoria"),
      ["un texto", 0.15, 50],
    ]);
    expect(r.casos.map((c) => c.id)).toEqual(["a"]);
    expect(r.casiDuplicadosDescartados).toBe(1);
  });

  it("si la base falla, o el texto está vacío, devuelve sin casos y no lanza", async () => {
    const roto = crearRecuperadorPgTrgm({
      query: async () => {
        throw new Error("base caída");
      },
    } as unknown as DbExecutor);
    expect(await roto("texto")).toEqual({
      casos: [],
      casiDuplicadosDescartados: 0,
    });
    const query = vi.fn();
    const vacio = crearRecuperadorPgTrgm({ query } as unknown as DbExecutor);
    expect(await vacio("   ")).toEqual({
      casos: [],
      casiDuplicadosDescartados: 0,
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("analizarMensaje con V2R", () => {
  const recuperadorCon = (
    casos: CasoSimilar[],
    descartados = 0,
  ): RecuperadorCasos =>
    vi.fn(async () => ({ casos, casiDuplicadosDescartados: descartados }));

  it("pone los casos en el prompt y deja en el paquete solo su id, categoría y similitud, sin texto", async () => {
    const { cliente, peticiones } = clienteEspia();
    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        variante: VarianteIa.V2R,
        cliente,
        recuperarCasos: recuperadorCon(
          [caso({ id: "x1", similitud: 0.31 })],
          2,
        ),
      },
    );
    expect(peticiones[0]?.usuario).toContain("La enfermera me trató mal");
    expect(p.casosSimilares).toEqual([
      { id: "x1", categoria: "QUEJA", similitud: 0.31 },
    ]);
    expect(p.casiDuplicadosDescartados).toBe(2);
    expect(JSON.stringify(p)).not.toContain("La enfermera me trató mal");
    expect(p.variante).toBe("V2R");
  });

  it("sigue siendo el paquete de siempre: explicación por plantilla, tope de confianza y sin desempate queja/reclamo", async () => {
    const { cliente } = clienteEspia();
    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        variante: VarianteIa.V2R,
        cliente,
        recuperarCasos: recuperadorCon([caso()]),
      },
    );
    expect(p.explicacion).toContain("Las reglas suman");
    expect(p.sinDesempateQuejaReclamo).toBe(true);
    expect(p.confianza).toBeLessThanOrEqual(95);
  });

  it("el modelo no baja un caso marcado por reglas aunque los casos parecidos sean quejas", async () => {
    const { cliente } = clienteEspia();
    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        variante: VarianteIa.V2R,
        cliente,
        recuperarCasos: recuperadorCon([caso(), caso({ id: "c2" })]),
      },
    );
    expect(p.reglas.propuestaCorrupcion).toBe(true);
    expect(p).toMatchObject({
      propuesta: "DENUNCIA_CORRUPCION",
      requiereOtrans: true,
    });
  });

  it("sin recuperador corre sin ejemplos y con un recuperador que lanza también (sin degradar)", async () => {
    const sin = clienteEspia();
    await analizarMensaje(
      TEXTO_COBRO,
      {},
      { variante: VarianteIa.V2R, cliente: sin.cliente },
    );
    expect(sin.peticiones[0]?.usuario).toContain("ninguno");

    const roto = clienteEspia();
    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        variante: VarianteIa.V2R,
        cliente: roto.cliente,
        recuperarCasos: async () => {
          throw new Error("falla");
        },
      },
    );
    expect(p.degradado).toBe(false);
    expect(p.casosSimilares).toEqual([]);
    expect(roto.peticiones[0]?.usuario).toContain("ninguno");
  });

  it("solo V2R recupera casos: las otras variantes no llaman al recuperador", async () => {
    for (const variante of [VarianteIa.V2, VarianteIa.V2C, VarianteIa.V3]) {
      const recuperar = recuperadorCon([caso()]);
      await analizarMensaje(
        TEXTO_COBRO,
        {},
        {
          variante,
          cliente: clienteEspia().cliente,
          recuperarCasos: recuperar,
        },
      );
      expect(recuperar).not.toHaveBeenCalled();
    }
  });

  it("un texto corto no consulta ni al modelo ni al recuperador", async () => {
    const recuperar = recuperadorCon([caso()]);
    const { cliente } = clienteEspia();
    const p = await analizarMensaje(
      "hola",
      {},
      { variante: VarianteIa.V2R, cliente, recuperarCasos: recuperar },
    );
    expect(recuperar).not.toHaveBeenCalled();
    expect(cliente.consultar).not.toHaveBeenCalled();
    expect(p).toMatchObject({ variante: null, casosSimilares: [] });
  });

  it("si el modelo cae, degrada a solo reglas como siempre", async () => {
    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        variante: VarianteIa.V2R,
        recuperarCasos: recuperadorCon([caso()]),
        cliente: {
          consultar: async () => ({
            ok: false,
            motivo: MotivoFalloIa.SIN_CONEXION,
            metricas: METRICAS,
          }),
        },
      },
    );
    expect(p).toMatchObject({
      degradado: true,
      propuesta: "DENUNCIA_CORRUPCION",
      pesoIa: null,
    });
  });
});

const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("pg_trgm contra PostgreSQL real (tabla temporal)", () => {
  let cliente: pg.Client;
  let base: DbExecutor;

  beforeAll(async () => {
    cliente = new pg.Client({ connectionString: url as string });
    await cliente.connect();
    base = {
      query: async <T extends pg.QueryResultRow = pg.QueryResultRow>(
        texto: string,
        valores?: unknown[],
      ): Promise<T[]> => (await cliente.query<T>(texto, valores)).rows,
    };
    // Tabla temporal de esta conexión: no toca `ia.entrenamiento_categoria` y desaparece al cerrar.
    await cliente.query(`CREATE TEMP TABLE casos_prueba (
      id text, texto_entrenamiento text, categoria_final_id smallint, apto_entrenamiento boolean)`);
    await cliente.query(
      `INSERT INTO casos_prueba VALUES
       ('q1', 'La enfermera me trató mal en la ventanilla de admisión', 2, true),
       ('r1', 'Mi cita fue reprogramada tres veces sin avisarme', 3, true),
       ('c1', 'Me pidieron plata por debajo de la mesa para darme la cita', 1, true),
       ('x1', 'La enfermera me trató mal en la ventanilla de admisión del hospital', 2, false)`,
    );
  });

  afterAll(async () => {
    await cliente.end();
  });

  it("encuentra el caso más parecido, sin importar tildes ni mayúsculas, y respeta apto_entrenamiento", async () => {
    const recuperar = crearRecuperadorPgTrgm(base, {
      relacion: "pg_temp.casos_prueba",
      similitudCasiDuplicado: 0.95,
    });
    const r = await recuperar("LA ENFERMERA ME TRATO MAL EN LA VENTANILLA");
    expect(r.casos[0]).toMatchObject({ id: "q1", categoria: "QUEJA" });
    expect(r.casos.map((c) => c.id)).not.toContain("x1");
    expect(r.casos[0]?.similitud).toBeGreaterThan(0.5);
  });

  it("descarta el casi duplicado con el tope por defecto (0,5) y lo cuenta", async () => {
    const recuperar = crearRecuperadorPgTrgm(base, {
      relacion: "pg_temp.casos_prueba",
    });
    const r = await recuperar(
      "La enfermera me trató mal en la ventanilla de admisión",
    );
    expect(r.casos.map((c) => c.id)).not.toContain("q1");
    expect(r.casiDuplicadosDescartados).toBeGreaterThanOrEqual(1);
  });

  it("un texto sin parecido no trae casos", async () => {
    const recuperar = crearRecuperadorPgTrgm(base, {
      relacion: "pg_temp.casos_prueba",
    });
    const r = await recuperar("zzz qqq www");
    expect(r.casos).toEqual([]);
  });
});
