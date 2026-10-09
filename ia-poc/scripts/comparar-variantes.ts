// Compara por pares dos variantes del modelo usando SOLO sus cachés de respuestas (no llama al modelo).
// Uso (desde la raíz del repo):
//   npx tsx ia-poc/scripts/comparar-variantes.ts --a=V2 --b=V2C --conjunto=ia-poc/evaluacion/desarrollo-v2.jsonl
//   npx tsx ia-poc/scripts/comparar-variantes.ts --a=V2 --b=V2C --conjunto=ia-poc/evaluacion/prueba-v2.jsonl --universo-b=ids-de-a --desarrollo=ia-poc/evaluacion/resultados/comparacion-V2-V2C-desarrollo-v2.json
// Cachés: `ia-poc/evaluacion/cache/modelo-<variante>-<conjunto>.jsonl`. Resultado SIN textos (solo ids, tipo de caso y agregados):
// `ia-poc/evaluacion/resultados/comparacion-<A>-<B>-<conjunto>.json`.
//   --universo-b=conjunto (por defecto)  B se mide sobre todo el conjunto (desarrollo completo).
//   --universo-b=ids-de-a                B se mide sobre los ids que A tiene en su caché (prueba: los mismos 119 ids de V2).
//   --desarrollo=<json>                  agrega el veredicto final combinando este conjunto con el de desarrollo (sección 21: Q1 en los dos).
// Los criterios y el veredicto salen de `src/services/analisis-ia/comparacion-variantes.ts` (umbrales de la sección 21 del vault).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { PISO_PESO_POSIBLE_CORRUPCION_POR_DEFECTO } from "@/constants/analisis-ia.js";
import { VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { pesoEfectivoDelModelo } from "@/services/analisis-ia/analizar-mensaje.js";
import type { MetricasModelo } from "@/services/analisis-ia/analisis-ia.types.js";
import {
  acuerdoDeMarcas,
  combinarCriterios,
  decidirVeredicto,
  evaluarCriterios,
  intervaloWilson,
  media,
  paresDiscordantes,
  percentil,
  razon,
  type MarcaPareada,
  type MedidasParaCriterios,
  type ResultadoCriterio,
} from "@/services/analisis-ia/comparacion-variantes.js";
import type { SalidaIa } from "@/services/analisis-ia/esquema-salida.js";
import { combinarReglasConIa } from "@/services/filtro-corrupcion/combinar-reglas-con-ia.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";
import type { ResultadoCorrupcion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

interface Mensaje {
  id: string;
  texto: string;
  categoria_esperada: string;
  tipo_caso?: string | null;
}

interface LineaDeCache {
  id: string;
  variante: VarianteIa;
  salida: SalidaIa;
  metricas: MetricasModelo;
}

interface Fila {
  mensaje: Mensaje;
  reglas: ResultadoCorrupcion;
  esperadoCorrupcion: boolean;
}

const { DENUNCIA_CORRUPCION, QUEJA, RECLAMO } = CategoriaIncidencia;
const SIN_TIPO = "(sin dato)";

const argumentos = process.argv.slice(2);
const valorDe = (nombre: string): string | undefined =>
  argumentos
    .find((a) => a.startsWith(`--${nombre}=`))
    ?.slice(nombre.length + 3);
const varianteA = valorDe("a") as VarianteIa | undefined;
const varianteB = valorDe("b") as VarianteIa | undefined;
const rutaConjunto = valorDe("conjunto");
const universoB = valorDe("universo-b") ?? "conjunto";
const rutaDesarrollo = valorDe("desarrollo");
const variantesValidas: string[] = Object.values(VarianteIa);

if (
  !varianteA ||
  !varianteB ||
  !rutaConjunto ||
  !variantesValidas.includes(varianteA) ||
  !variantesValidas.includes(varianteB) ||
  !["conjunto", "ids-de-a"].includes(universoB)
) {
  console.error(
    "Uso: --a=V2 --b=V2C --conjunto=<ruta.jsonl> [--universo-b=conjunto|ids-de-a] [--desarrollo=<comparacion.json>]",
  );
  process.exit(2);
}

const nombreConjunto = basename(rutaConjunto).replace(/\.jsonl$/, "");
const carpeta = resolve("ia-poc/evaluacion");
const leerLineas = <T>(ruta: string): T[] =>
  existsSync(ruta)
    ? readFileSync(ruta, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as T)
    : [];
const leerCache = (variante: VarianteIa): LineaDeCache[] =>
  leerLineas<LineaDeCache>(
    resolve(carpeta, "cache", `modelo-${variante}-${nombreConjunto}.jsonl`),
  ).filter((l) => l.variante === variante);

const lineasA = leerCache(varianteA);
const lineasB = leerCache(varianteB);
const cacheA = new Map(lineasA.map((l) => [l.id, l]));
const cacheB = new Map(lineasB.map((l) => [l.id, l]));
/** La primera línea de la caché es la primera llamada de la corrida: se excluye de las latencias (puede traer carga o prefijo en frío). */
const primeraA = lineasA[0]?.id;
const primeraB = lineasB[0]?.id;

const piso = PISO_PESO_POSIBLE_CORRUPCION_POR_DEFECTO;
const mensajes = leerLineas<Mensaje>(resolve(rutaConjunto));
const filaDe = (mensaje: Mensaje): Fila => ({
  mensaje,
  reglas: evaluarTextoCorrupcion(mensaje.texto),
  esperadoCorrupcion: mensaje.categoria_esperada === DENUNCIA_CORRUPCION,
});
const todas = mensajes.map(filaDe);
const pares = todas.filter(
  (f) => cacheA.has(f.mensaje.id) && cacheB.has(f.mensaje.id),
);
const universo =
  universoB === "ids-de-a"
    ? todas.filter((f) => cacheA.has(f.mensaje.id))
    : todas;

type Cache = Map<string, LineaDeCache>;

/** ¿Reglas + modelo (con el piso dado) proponen corrupción? Sin respuesta del modelo valen solo las reglas. */
function propone(fila: Fila, cache: Cache, pisoPeso: number | null): boolean {
  const salida = cache.get(fila.mensaje.id)?.salida;
  return combinarReglasConIa(
    fila.reglas,
    salida ? pesoEfectivoDelModelo(salida, pisoPeso) : null,
  ).propuestaCorrupcion;
}

const redondear = (v: number | null, d = 6): number | null =>
  v === null ? null : Math.round(v * 10 ** d) / 10 ** d;

function corrupcion(
  filas: readonly Fila[],
  predicho: (f: Fila) => boolean,
): Record<string, unknown> & { recall: number | null; tasaFp: number | null } {
  const vp = filas.filter((f) => f.esperadoCorrupcion && predicho(f)).length;
  const fn = filas.filter((f) => f.esperadoCorrupcion && !predicho(f)).length;
  const fp = filas.filter((f) => !f.esperadoCorrupcion && predicho(f)).length;
  const negativos = filas.length - vp - fn;
  const recall = razon(vp, vp + fn);
  const precision = razon(vp, vp + fp);
  const tasaFp = razon(fp, negativos);
  return {
    mensajes: filas.length,
    corrupcionEsperada: vp + fn,
    negativos,
    vp,
    fn,
    fp,
    recall: redondear(recall),
    recallWilson95: intervaloWilson(vp, vp + fn),
    precision: redondear(precision),
    tasaFp: redondear(tasaFp),
    tasaFpWilson95: intervaloWilson(fp, negativos),
  };
}

function categorias(filas: readonly Fila[], cache: Cache) {
  const conSalida = filas.filter((f) => cache.has(f.mensaje.id));
  const acierta = conSalida.filter(
    (f) => cache.get(f.mensaje.id)?.salida.categoria === f.mensaje.categoria_esperada,
  ).length;
  const esQR = (c: string | undefined): boolean => c === QUEJA || c === RECLAMO;
  const qr = conSalida.filter(
    (f) =>
      esQR(f.mensaje.categoria_esperada) &&
      esQR(cache.get(f.mensaje.id)?.salida.categoria),
  );
  const acuerdoQR = qr.filter(
    (f) =>
      cache.get(f.mensaje.id)?.salida.categoria === f.mensaje.categoria_esperada,
  ).length;
  return {
    exactitud4Categorias: razon(acierta, conSalida.length),
    aciertos: acierta,
    de: conSalida.length,
    acuerdoQuejaReclamo: razon(acuerdoQR, qr.length),
    acuerdoQuejaReclamoAciertos: acuerdoQR,
    acuerdoQuejaReclamoDe: qr.length,
  };
}

function jsonPrimerIntento(filas: readonly Fila[], cache: Cache) {
  const consultadas = filas.filter((f) => f.reglas.aplica);
  const primero = consultadas.filter(
    (f) => cache.get(f.mensaje.id)?.metricas.intentos === 1,
  ).length;
  const conSalida = consultadas.filter((f) => cache.has(f.mensaje.id)).length;
  return {
    consultadas: consultadas.length,
    conSalidaValida: conSalida,
    sinRespuesta: consultadas.length - conSalida,
    validosAlPrimerIntento: primero,
    tasa: razon(primero, consultadas.length),
  };
}

function latencia(
  filas: readonly Fila[],
  cache: Cache,
  primeraId: string | undefined,
) {
  const lineas = filas
    .map((f) => cache.get(f.mensaje.id))
    .filter((l): l is LineaDeCache => l !== undefined);
  const medidas = lineas.filter((l) => l.id !== primeraId);
  const ms = medidas.map((l) => l.metricas.duracionMs).filter((v) => v > 0);
  const tokens = medidas
    .map((l) => l.metricas.tokensSalida ?? 0)
    .filter((v) => v > 0);
  return {
    llamadas: lineas.length,
    llamadasMedidas: ms.length,
    primeraLlamadaExcluida: lineas.some((l) => l.id === primeraId),
    mediaMs: redondear(media(ms), 0),
    p90Ms: percentil(ms, 0.9),
    tokensSalidaMedia: redondear(media(tokens), 1),
  };
}

function resumenDe(
  filas: readonly Fila[],
  cache: Cache,
  primeraId: string | undefined,
) {
  const conPiso = corrupcion(filas, (f) => propone(f, cache, piso));
  return {
    soloReglas: corrupcion(filas, (f) => f.reglas.propuestaCorrupcion),
    reglasMasModeloConPiso: conPiso,
    reglasMasModeloSinPiso: corrupcion(filas, (f) => propone(f, cache, null)),
    categorias: categorias(filas, cache),
    jsonPrimerIntento: jsonPrimerIntento(filas, cache),
    latencia: latencia(filas, cache, primeraId),
  };
}

const resumenA = resumenDe(pares, cacheA, primeraA);
const resumenBPares = resumenDe(pares, cacheB, primeraB);
const resumenBUniverso = resumenDe(universo, cacheB, primeraB);

// Pares discordantes: la marca del modelo (`posible_corrupcion`, la de Q3) y la propuesta final (reglas + modelo con piso).
const marcaDelModelo = (cache: Cache, f: Fila): boolean =>
  cache.get(f.mensaje.id)?.salida.posible_corrupcion ?? false;
const paresDeMarca = (marca: (cache: Cache, f: Fila) => boolean) =>
  pares.map(
    (f): MarcaPareada => ({
      id: f.mensaje.id,
      tipoCaso: f.mensaje.tipo_caso ?? null,
      marcaA: marca(cacheA, f),
      marcaB: marca(cacheB, f),
      esperadoCorrupcion: f.esperadoCorrupcion,
    }),
  );
const paresModelo = paresDeMarca(marcaDelModelo);
const paresFinal = paresDeMarca((cache, f) => propone(f, cache, piso));

const medidas: MedidasParaCriterios = {
  recallB: resumenBUniverso.reglasMasModeloConPiso.recall,
  recallParesA: resumenA.reglasMasModeloConPiso.recall,
  recallParesB: resumenBPares.reglasMasModeloConPiso.recall,
  fpB: resumenBUniverso.reglasMasModeloConPiso.tasaFp,
  fpParesA: resumenA.reglasMasModeloConPiso.tasaFp,
  fpParesB: resumenBPares.reglasMasModeloConPiso.tasaFp,
  acuerdoMarca: acuerdoDeMarcas(paresModelo),
  exactitudParesA: resumenA.categorias.exactitud4Categorias,
  exactitudParesB: resumenBPares.categorias.exactitud4Categorias,
  acuerdoQuejaReclamoB: resumenBUniverso.categorias.acuerdoQuejaReclamo,
  jsonPrimerIntentoB: resumenBUniverso.jsonPrimerIntento.tasa,
  latenciaMediaB: resumenBUniverso.latencia.mediaMs,
  p90B: resumenBUniverso.latencia.p90Ms,
  latenciaMediaParesA: resumenA.latencia.mediaMs,
  latenciaMediaParesB: resumenBPares.latencia.mediaMs,
};
const criterios = evaluarCriterios(medidas);
const veredicto = decidirVeredicto(criterios);

let veredictoFinal: ReturnType<typeof decidirVeredicto> | null = null;
let criteriosFinales: ResultadoCriterio[] | null = null;
if (rutaDesarrollo) {
  const previo = JSON.parse(readFileSync(resolve(rutaDesarrollo), "utf8")) as {
    criterios: ResultadoCriterio[];
  };
  criteriosFinales = combinarCriterios([previo.criterios, criterios]);
  veredictoFinal = decidirVeredicto(criteriosFinales);
}

const resultado = {
  a: varianteA,
  b: varianteB,
  conjunto: nombreConjunto,
  pisoPesoPosibleCorrupcion: piso,
  universoB,
  ids: {
    pares: pares.length,
    universoB: universo.length,
    sinRespuestaDeB: resumenBUniverso.jsonPrimerIntento.sinRespuesta,
    primeraLlamadaExcluidaA: primeraA ?? null,
    primeraLlamadaExcluidaB: primeraB ?? null,
  },
  pareado: { [varianteA]: resumenA, [varianteB]: resumenBPares },
  absolutoDeB: resumenBUniverso,
  acuerdo: {
    marcaDelModelo: redondear(acuerdoDeMarcas(paresModelo)),
    propuestaFinal: redondear(acuerdoDeMarcas(paresFinal)),
  },
  paresDiscordantes: {
    marcaDelModelo: paresDiscordantes(paresModelo),
    propuestaFinal: paresDiscordantes(paresFinal),
  },
  medidas,
  criterios,
  veredicto,
  ...(veredictoFinal && criteriosFinales
    ? { criteriosFinales, veredictoFinal }
    : {}),
};

const rutaResultado = resolve(
  carpeta,
  "resultados",
  `comparacion-${varianteA}-${varianteB}-${nombreConjunto}.json`,
);
writeFileSync(rutaResultado, JSON.stringify(resultado, null, 2) + "\n");

const pct = (v: number | null): string =>
  v === null ? "n/d" : `${(v * 100).toFixed(1)}%`;
const seg = (v: number | null): string =>
  v === null ? "n/d" : `${(v / 1000).toFixed(2)} s`;
console.log(
  `=== ${varianteA} frente a ${varianteB} en ${nombreConjunto}: ${pares.length} ids pareados; ${varianteB} medido en ${universo.length} ===`,
);
for (const [nombre, r] of [
  [varianteA, resumenA],
  [`${varianteB} (pares)`, resumenBPares],
  [`${varianteB} (universo)`, resumenBUniverso],
] as const)
  console.log(
    `${nombre.padEnd(14)} recall ${pct(r.reglasMasModeloConPiso.recall)} FP ${pct(r.reglasMasModeloConPiso.tasaFp)} cat ${pct(r.categorias.exactitud4Categorias)} Q/R ${pct(r.categorias.acuerdoQuejaReclamo)} JSON1 ${pct(r.jsonPrimerIntento.tasa)} lat ${seg(r.latencia.mediaMs)} p90 ${seg(r.latencia.p90Ms)} tokens ${r.latencia.tokensSalidaMedia}`,
  );
console.log(
  `Acuerdo de marca del modelo ${pct(acuerdoDeMarcas(paresModelo))}; propuesta final ${pct(acuerdoDeMarcas(paresFinal))}`,
);
for (const d of resultado.paresDiscordantes.marcaDelModelo)
  console.log(
    `  discordante ${d.id} (${d.tipoCaso ?? SIN_TIPO}) ${d.lado} esperado corrupción=${d.esperadoCorrupcion} acierta ${d.acierta}`,
  );
for (const c of criterios)
  console.log(
    `  ${c.id}: ${c.cumple ? "cumple" : `NO cumple (falta ${c.faltaPuntos ?? "sin dato"})`} ${c.subcondiciones.map((s) => `${s.nombre}=${s.valor === null ? "n/d" : redondear(s.valor, 4)}`).join("; ")}`,
  );
console.log(`Veredicto (${nombreConjunto}): ${veredicto.veredicto}. ${veredicto.motivo}`);
if (veredictoFinal)
  console.log(
    `Veredicto FINAL (desarrollo + ${nombreConjunto}): ${veredictoFinal.veredicto}. ${veredictoFinal.motivo}`,
  );
console.log(`Guardado en ${rutaResultado}`);
