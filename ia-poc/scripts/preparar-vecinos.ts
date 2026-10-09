// Calcula, para cada mensaje de un conjunto, los casos revisados más parecidos del banco con `pg_trgm` (la misma recuperación de V2R), SIN
// tocar la GPU ni escribir en tablas reales. Uso (desde la raíz del repo):
//   npx tsx ia-poc/scripts/preparar-vecinos.ts --conjunto=ia-poc/evaluacion/desarrollo-v2.jsonl [--banco=ia-poc/evaluacion/desarrollo.jsonl,ia-poc/evaluacion/prueba-t1.jsonl] [--ids-de=V2C]
// Una sola conexión: crea una TABLA TEMPORAL con el banco (desaparece al cerrar la conexión), corre una consulta corta por mensaje y cierra.
// `ia.entrenamiento_categoria` y cualquier otra tabla real no se tocan. Base: TEST_DATABASE_URL (por defecto la desechable local).
// Escribe `ia-poc/evaluacion/cache/vecinos-<conjunto>.jsonl` (solo ids y similitudes; no se versiona) y el resumen SIN textos en
// `ia-poc/evaluacion/resultados/vecinos-<conjunto>.json` (tamaño y origen del banco, distribución de ejemplos, casi duplicados y chequeos H1 y H2).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import pg from "pg";
import {
  CASOS_SIMILARES_MAXIMOS,
  SIMILITUD_CASI_DUPLICADO,
  SIMILITUD_MINIMA_CASO,
} from "@/constants/casos-similares.js";
import type { DbExecutor } from "@/database/database.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { crearRecuperadorPgTrgm } from "@/services/analisis-ia/casos/recuperar-casos.js";

interface Mensaje {
  id: string;
  texto: string;
  categoria_esperada: string;
}

interface LineaDeVecinos {
  id: string;
  vecinos: { id: string; categoria: string; similitud: number }[];
  casiDuplicadosDescartados: number;
}

const BANCO_POR_DEFECTO = [
  "ia-poc/evaluacion/desarrollo.jsonl",
  "ia-poc/evaluacion/prueba-t1.jsonl",
];
/** Conjuntos que NUNCA pueden estar en el banco: los evaluados y la reserva (sección 25, H1). */
const PROHIBIDOS_EN_EL_BANCO = [
  "ia-poc/evaluacion/desarrollo-v2.jsonl",
  "ia-poc/evaluacion/prueba-v2.jsonl",
  "ia-poc/evaluacion/reserva-v2.jsonl",
];
const URL_POR_DEFECTO =
  "postgresql://postgres@127.0.0.1:54319/gestion2_desechable";
const RELACION_TEMPORAL = "pg_temp.casos_banco";
const ID_DE_CATEGORIA: Readonly<Record<string, number>> = {
  [CategoriaIncidencia.DENUNCIA_CORRUPCION]: 1,
  [CategoriaIncidencia.QUEJA]: 2,
  [CategoriaIncidencia.RECLAMO]: 3,
  [CategoriaIncidencia.OTRO]: 4,
};

const argumentos = process.argv.slice(2);
const valorDe = (nombre: string): string | undefined =>
  argumentos
    .find((a) => a.startsWith(`--${nombre}=`))
    ?.slice(nombre.length + 3);
const rutaConjunto = valorDe("conjunto");
const rutasBanco = valorDe("banco")?.split(",") ?? BANCO_POR_DEFECTO;
const idsDe = valorDe("ids-de");
if (!rutaConjunto) {
  console.error(
    "Uso: --conjunto=<ruta.jsonl> [--banco=a.jsonl,b.jsonl] [--ids-de=V2C]",
  );
  process.exit(2);
}

const leerLineas = <T>(ruta: string): T[] =>
  existsSync(ruta)
    ? readFileSync(ruta, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as T)
    : [];

const nombreConjunto = basename(rutaConjunto).replace(/\.jsonl$/, "");
const carpeta = resolve("ia-poc/evaluacion");
mkdirSync(resolve(carpeta, "cache"), { recursive: true });

const banco = rutasBanco.flatMap((r) => leerLineas<Mensaje>(resolve(r)));
let evaluados = leerLineas<Mensaje>(resolve(rutaConjunto));
if (idsDe) {
  const ids = new Set(
    leerLineas<{ id: string; variante: string }>(
      resolve(carpeta, "cache", `modelo-${idsDe}-${nombreConjunto}.jsonl`),
    ).map((l) => l.id),
  );
  evaluados = evaluados.filter((m) => ids.has(m.id));
}

// H1: el banco no puede contener ningún caso del conjunto evaluado ni de los conjuntos v2 (por id ni por texto idéntico).
const normalizar = (t: string): string =>
  t.replace(/\s+/g, " ").trim().toLowerCase();
const prohibidos = PROHIBIDOS_EN_EL_BANCO.flatMap((r) =>
  leerLineas<Mensaje>(resolve(r)),
);
const idsProhibidos = new Set([...prohibidos, ...evaluados].map((m) => m.id));
const textosProhibidos = new Set(
  [...prohibidos, ...evaluados].map((m) => normalizar(m.texto)),
);
const casosDelBancoEnElConjunto = banco.filter(
  (c) => idsProhibidos.has(c.id) || textosProhibidos.has(normalizar(c.texto)),
).length;
if (casosDelBancoEnElConjunto > 0) {
  console.error(
    `H1 incumplida: ${casosDelBancoEnElConjunto} casos del banco están en el conjunto evaluado o en un conjunto prohibido. No se sigue.`,
  );
  process.exit(1);
}
if (new Set(banco.map((c) => c.id)).size !== banco.length) {
  console.error("Hay ids repetidos en el banco. No se sigue.");
  process.exit(1);
}

const cliente = new pg.Client({
  connectionString: process.env["TEST_DATABASE_URL"] ?? URL_POR_DEFECTO,
  statement_timeout: 20_000,
});
const lineas: LineaDeVecinos[] = [];
try {
  await cliente.connect();
  const base: DbExecutor = {
    query: async <T extends pg.QueryResultRow = pg.QueryResultRow>(
      texto: string,
      valores?: unknown[],
    ): Promise<T[]> => (await cliente.query<T>(texto, valores)).rows,
  };
  // Tabla temporal de ESTA conexión: no es una tabla real y desaparece al cerrar. Misma forma que lee la recuperación de producción.
  await cliente.query(`CREATE TEMP TABLE casos_banco (
    id text PRIMARY KEY, texto_entrenamiento text NOT NULL, categoria_final_id smallint NOT NULL, apto_entrenamiento boolean NOT NULL)`);
  await cliente.query(
    `INSERT INTO casos_banco
     SELECT * FROM unnest($1::text[], $2::text[], $3::smallint[], $4::boolean[])`,
    [
      banco.map((c) => c.id),
      banco.map((c) => c.texto),
      banco.map((c) => ID_DE_CATEGORIA[c.categoria_esperada] ?? 4),
      banco.map(() => true),
    ],
  );
  const recuperar = crearRecuperadorPgTrgm(base, {
    relacion: RELACION_TEMPORAL,
  });
  for (const mensaje of evaluados) {
    const r = await recuperar(mensaje.texto);
    lineas.push({
      id: mensaje.id,
      vecinos: r.casos.map((c) => ({
        id: c.id,
        categoria: c.categoria,
        similitud: c.similitud,
      })),
      casiDuplicadosDescartados: r.casiDuplicadosDescartados,
    });
  }
} finally {
  await cliente.end().catch(() => undefined);
}

writeFileSync(
  resolve(carpeta, "cache", `vecinos-${nombreConjunto}.jsonl`),
  lineas.map((l) => JSON.stringify(l)).join("\n") + "\n",
);

// H2: ningún par mensaje-ejemplo con similitud de 0,50 o más llega al prompt.
const paresCasiDuplicadoEnElPrompt = lineas.reduce(
  (suma, l) =>
    suma +
    l.vecinos.filter((v) => v.similitud >= SIMILITUD_CASI_DUPLICADO).length,
  0,
);
const similitudes = lineas
  .flatMap((l) => l.vecinos.map((v) => v.similitud))
  .sort((a, b) => a - b);
const percentil = (p: number): number | null =>
  similitudes.length === 0
    ? null
    : (similitudes[
        Math.min(similitudes.length - 1, Math.ceil(p * similitudes.length) - 1)
      ] ?? null);
const cuentaPor = <T extends string | number>(
  valores: readonly T[],
): Record<string, number> => {
  const cuenta: Record<string, number> = {};
  for (const v of valores) cuenta[String(v)] = (cuenta[String(v)] ?? 0) + 1;
  return cuenta;
};
const porCategoriaDelBanco = cuentaPor(banco.map((c) => c.categoria_esperada));

const resumen = {
  conjunto: nombreConjunto,
  mensajesEvaluados: evaluados.length,
  parametros: {
    maximo: CASOS_SIMILARES_MAXIMOS,
    similitudMinima: SIMILITUD_MINIMA_CASO,
    similitudCasiDuplicado: SIMILITUD_CASI_DUPLICADO,
  },
  banco: {
    casos: banco.length,
    origen: rutasBanco.map((r) => ({
      archivo: basename(r),
      casos: leerLineas<Mensaje>(resolve(r)).length,
      tipo: "sintetico",
    })),
    reales: 0,
    porCategoria: porCategoriaDelBanco,
    excluidosPorDiseno: [
      ...PROHIBIDOS_EN_EL_BANCO.map((r) => basename(r)),
      "ia.entrenamiento_categoria de la base desechable (32 filas de pruebas y semillas, no son revisiones reales)",
    ],
  },
  recuperacion: {
    mensajesConEjemplos: lineas.filter((l) => l.vecinos.length > 0).length,
    ejemplosPorMensaje: cuentaPor(lineas.map((l) => l.vecinos.length)),
    similitud: {
      minima: similitudes[0] ?? null,
      mediana: percentil(0.5),
      p90: percentil(0.9),
      maxima: similitudes.at(-1) ?? null,
    },
    categoriaDeLosEjemplos: cuentaPor(
      lineas.flatMap((l) => l.vecinos.map((v) => v.categoria)),
    ),
    mensajesConCasiDuplicadosDescartados: lineas.filter(
      (l) => l.casiDuplicadosDescartados > 0,
    ).length,
    casiDuplicadosDescartados: lineas.reduce(
      (s, l) => s + l.casiDuplicadosDescartados,
      0,
    ),
  },
  higiene: {
    H1_casosDelBancoEnElConjunto: casosDelBancoEnElConjunto,
    H2_paresCasiDuplicadoEnElPrompt: paresCasiDuplicadoEnElPrompt,
  },
};
writeFileSync(
  resolve(carpeta, "resultados", `vecinos-${nombreConjunto}.json`),
  JSON.stringify(resumen, null, 2) + "\n",
);
console.log(JSON.stringify(resumen, null, 2));
