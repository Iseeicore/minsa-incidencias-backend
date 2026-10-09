import {
  criterio,
  diferencia,
  maximo,
  minimo,
  type ResultadoCriterio,
} from "@/services/analisis-ia/comparacion-variantes.js";

/**
 * Criterios de aceptación de V2R (RAG de casos revisados con `pg_trgm`), sección 25 de la nota «Plan de PoC de IA - Reglas primero,
 * modelo después y derivación a OTRANS». Se escribieron ANTES de medir y no se cambian después de ver los resultados. La referencia es
 * V2C (no V2). Las razones van de 0 a 1 ("2 puntos" = 0,02); las latencias, en milisegundos.
 */
export const UMBRALES_SECCION_25 = {
  R1_RECALL_MINIMO: 0.95,
  R1_FN_ADICIONALES_MAXIMOS_FRENTE_A_BASE: 1,
  R2_FP_MAXIMO: 0.15,
  R2_SUBIDA_MAXIMA_FRENTE_A_BASE: 0.02,
  R3_JSON_PRIMER_INTENTO_MINIMO: 0.99,
  V1_LATENCIA_MEDIA_MAXIMA_MS: 5_000,
  V1_SOBRE_BASE_MAXIMO_MS: 2_000,
  V2_P90_MAXIMO_MS: 8_000,
  /** Ganancia neta mínima de categoría: depende del tamaño del conjunto (303 en desarrollo-v2, 119 ids en la prueba). */
  M1_GANANCIA_NETA_DESARROLLO: 6,
  M1_GANANCIA_NETA_PRUEBA: 3,
  M2_ACUERDO_QUEJA_RECLAMO_MINIMO: 0.85,
} as const;

export const IdCriterio25 = {
  R1: "R1",
  R2: "R2",
  R3: "R3",
  V1: "V1",
  V2: "V2",
  M1: "M1",
  M2: "M2",
  M3: "M3",
  H1: "H1",
  H2: "H2",
  H3: "H3",
} as const;
export type IdCriterio25 = (typeof IdCriterio25)[keyof typeof IdCriterio25];

export const VeredictoRag = {
  MEJORA_COMPROBADA: "Mejora comprobada",
  SIN_MEJORA_CLARA: "Sin mejora clara (se mantiene V2C)",
  NO_VIABLE: "No viable",
} as const;
export type VeredictoRag = (typeof VeredictoRag)[keyof typeof VeredictoRag];

/** Lo que el veredicto necesita de una comparación sobre un conjunto. R es V2R; la base es V2C. `null` si no hay dato. */
export interface MedidasSeccion25 {
  /** Umbral de ganancia neta que corresponde a este conjunto (`M1_GANANCIA_NETA_*`). */
  umbralGananciaNeta: number;
  recallR: number | null;
  falsosNegativosR: number;
  falsosNegativosBase: number;
  fpR: number | null;
  fpParesR: number | null;
  fpParesBase: number | null;
  jsonPrimerIntentoR: number | null;
  latenciaMediaR: number | null;
  latenciaMediaBase: number | null;
  p90R: number | null;
  /** Aciertos de categoría de V2R que V2C erraba, menos los de V2C que V2R erra. */
  gananciaNetaCategoria: number | null;
  acuerdoQuejaReclamoR: number | null;
  acuerdoQuejaReclamoBase: number | null;
  exactitudR: number | null;
  exactitudBase: number | null;
  /** H1: casos del banco que son del conjunto evaluado o de reserva (por id o por texto idéntico). */
  casosDelBancoEnElConjunto: number;
  /** H2: pares mensaje-ejemplo con similitud de 0,50 o más que llegaron al prompt. */
  paresCasiDuplicadoEnElPrompt: number;
  /** H3: textos de mensajes que aparecen en el informe. */
  textosEnElInforme: number;
}

const cuenta = (nombre: string, valor: number, tope: number) =>
  maximo(nombre, valor, tope, false);

/** Evalúa R1 a R3, V1, V2, M1 a M3 y H1 a H3 con los umbrales de la sección 25 sobre un conjunto. Función pura. */
export function evaluarCriteriosSeccion25(
  m: MedidasSeccion25,
): ResultadoCriterio[] {
  const u = UMBRALES_SECCION_25;
  const sobreBase = diferencia(m.latenciaMediaR, m.latenciaMediaBase);
  return [
    criterio(IdCriterio25.R1, [
      minimo("recall de V2R (reglas + modelo)", m.recallR, u.R1_RECALL_MINIMO),
      cuenta(
        "falsos negativos de V2R menos los de V2C",
        m.falsosNegativosR - m.falsosNegativosBase,
        u.R1_FN_ADICIONALES_MAXIMOS_FRENTE_A_BASE,
      ),
    ]),
    criterio(IdCriterio25.R2, [
      maximo("falsos positivos de V2R sobre negativos", m.fpR, u.R2_FP_MAXIMO),
      maximo(
        "FP de V2R menos FP de V2C, por pares",
        diferencia(m.fpParesR, m.fpParesBase),
        u.R2_SUBIDA_MAXIMA_FRENTE_A_BASE,
      ),
    ]),
    criterio(IdCriterio25.R3, [
      minimo(
        "JSON válido al primer intento",
        m.jsonPrimerIntentoR,
        u.R3_JSON_PRIMER_INTENTO_MINIMO,
      ),
    ]),
    criterio(IdCriterio25.V1, [
      maximo(
        "latencia media de V2R (ms)",
        m.latenciaMediaR,
        u.V1_LATENCIA_MEDIA_MAXIMA_MS,
        false,
      ),
      maximo(
        "latencia de V2R menos la de V2C (ms)",
        sobreBase,
        u.V1_SOBRE_BASE_MAXIMO_MS,
        false,
      ),
    ]),
    criterio(IdCriterio25.V2, [
      maximo("percentil 90 de V2R (ms)", m.p90R, u.V2_P90_MAXIMO_MS, false),
    ]),
    criterio(IdCriterio25.M1, [
      minimo(
        "ganancia neta de categoría (mensajes)",
        m.gananciaNetaCategoria,
        m.umbralGananciaNeta,
        false,
      ),
    ]),
    criterio(IdCriterio25.M2, [
      minimo(
        "acuerdo de V2R entre queja y reclamo",
        m.acuerdoQuejaReclamoR,
        u.M2_ACUERDO_QUEJA_RECLAMO_MINIMO,
      ),
      minimo(
        "acuerdo de V2R menos el de V2C",
        diferencia(m.acuerdoQuejaReclamoR, m.acuerdoQuejaReclamoBase),
        0,
      ),
    ]),
    criterio(IdCriterio25.M3, [
      minimo(
        "exactitud de V2R menos la de V2C",
        diferencia(m.exactitudR, m.exactitudBase),
        0,
      ),
    ]),
    criterio(IdCriterio25.H1, [
      cuenta(
        "casos del banco dentro del conjunto evaluado",
        m.casosDelBancoEnElConjunto,
        0,
      ),
    ]),
    criterio(IdCriterio25.H2, [
      cuenta(
        "pares con similitud de 0,50 o más en el prompt",
        m.paresCasiDuplicadoEnElPrompt,
        0,
      ),
    ]),
    criterio(IdCriterio25.H3, [
      cuenta("textos de mensajes en el informe", m.textosEnElInforme, 0),
    ]),
  ];
}

export interface ResultadoVeredictoRag {
  veredicto: VeredictoRag;
  motivo: string;
}

const fallan = (
  criterios: readonly ResultadoCriterio[],
  ids: readonly string[],
): string[] =>
  criterios.filter((c) => ids.includes(c.id) && !c.cumple).map((c) => c.id);

/**
 * Veredicto de la sección 25:
 * - No viable: falla R1, R2, R3, V1, V2 o cualquier criterio de higiene (H1 a H3). Una mejora con la higiene rota no cuenta.
 * - Sin mejora clara (se mantiene V2C): cumple lo anterior pero falla M1, M2 o M3.
 * - Mejora comprobada: cumple todo.
 */
export function decidirVeredictoSeccion25(
  criterios: readonly ResultadoCriterio[],
): ResultadoVeredictoRag {
  const graves = fallan(criterios, [
    IdCriterio25.R1,
    IdCriterio25.R2,
    IdCriterio25.R3,
    IdCriterio25.V1,
    IdCriterio25.V2,
    IdCriterio25.H1,
    IdCriterio25.H2,
    IdCriterio25.H3,
  ]);
  if (graves.length > 0)
    return {
      veredicto: VeredictoRag.NO_VIABLE,
      motivo: `Falla ${graves.join(", ")}.`,
    };
  const mejora = fallan(criterios, [
    IdCriterio25.M1,
    IdCriterio25.M2,
    IdCriterio25.M3,
  ]);
  if (mejora.length > 0)
    return {
      veredicto: VeredictoRag.SIN_MEJORA_CLARA,
      motivo: `No se pierde seguridad ni velocidad, pero falla ${mejora.join(", ")}.`,
    };
  return {
    veredicto: VeredictoRag.MEJORA_COMPROBADA,
    motivo: "Cumple R1 a R3, V1, V2, M1 a M3 y H1 a H3.",
  };
}

/** Ganancia neta de categoría: los que V2R acierta y la base no, menos los que la base acierta y V2R no. Función pura. */
export function gananciaNeta(
  pares: readonly { aciertaR: boolean; aciertaBase: boolean }[],
): number {
  return (
    pares.filter((p) => p.aciertaR && !p.aciertaBase).length -
    pares.filter((p) => !p.aciertaR && p.aciertaBase).length
  );
}
