/**
 * Funciones puras de la comparación por pares de dos variantes del modelo (`ia-poc/scripts/comparar-variantes.ts`): intervalos de
 * Wilson, percentiles, pares discordantes y el veredicto automático de V2C.
 *
 * Los umbrales de `UMBRALES_SECCION_21` son EXACTAMENTE los de la sección 21 de la nota «Plan de PoC de IA - Reglas primero, modelo
 * después y derivación a OTRANS» («Criterios de viabilidad de V2C, definidos ANTES de medir»). No se cambian después de ver los
 * resultados: si un criterio resulta mal planteado se anota como hallazgo y se vuelve a medir con datos nuevos.
 */

/** Z del intervalo de Wilson al 95 %. */
const Z_95 = 1.959964;
/** Tolerancia numérica al comparar razones con un umbral (0,95 no es exacto en coma flotante). */
const EPSILON = 1e-9;
const PUNTOS_PORCENTUALES = 100;

export const IdCriterio = {
  Q1: "Q1",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4",
  Q5: "Q5",
  S1: "S1",
  S2: "S2",
} as const;
export type IdCriterio = (typeof IdCriterio)[keyof typeof IdCriterio];

export const Veredicto = {
  VIABLE: "Viable",
  VIABLE_CON_RESERVAS: "Viable con reservas",
  NO_VIABLE: "No viable",
} as const;
export type Veredicto = (typeof Veredicto)[keyof typeof Veredicto];

export const Lado = {
  SOLO_A: "SOLO_A",
  SOLO_B: "SOLO_B",
} as const;
export type Lado = (typeof Lado)[keyof typeof Lado];

/**
 * Sección 21 del vault. Las razones van de 0 a 1 ("3 puntos" = 0,03); las latencias, en milisegundos.
 * - Q1: recall de corrupción con reglas + modelo ≥ 95 % (en desarrollo y en prueba) y no más de 3 puntos por debajo de V2 por pares.
 * - Q2: falsos positivos sobre los negativos ≤ 15 % y no más de 3 puntos por encima de V2 por pares.
 * - Q3: acuerdo con V2 en la marca de corrupción, por pares ≥ 95 %.
 * - Q4: exactitud de las 4 categorías no más de 3 puntos por debajo de V2, y queja frente a reclamo ≥ 85 % de acuerdo.
 * - Q5: JSON válido al primer intento ≥ 99 %.
 * - S1: latencia media ≤ 5 s sin la primera llamada, y al menos 3 veces más rápida que V2.
 * - S2: percentil 90 ≤ 8 s.
 * - «Por poco» (viable con reservas) = menos de 2 puntos de falta.
 */
export const UMBRALES_SECCION_21 = {
  Q1_RECALL_MINIMO: 0.95,
  Q1_CAIDA_MAXIMA_FRENTE_A_A: 0.03,
  Q2_FP_MAXIMO: 0.15,
  Q2_SUBIDA_MAXIMA_FRENTE_A_A: 0.03,
  Q3_ACUERDO_MARCA_MINIMO: 0.95,
  Q4_CAIDA_EXACTITUD_MAXIMA_FRENTE_A_A: 0.03,
  Q4_ACUERDO_QUEJA_RECLAMO_MINIMO: 0.85,
  Q5_JSON_PRIMER_INTENTO_MINIMO: 0.99,
  S1_LATENCIA_MEDIA_MAXIMA_MS: 5_000,
  S1_VECES_MAS_RAPIDA_QUE_A: 3,
  S2_P90_MAXIMO_MS: 8_000,
  POR_POCO_PUNTOS: 2,
} as const;

export interface IntervaloWilson {
  inferior: number;
  superior: number;
}

/** Intervalo de Wilson al 95 % para `exitos` de `total`. `null` si no hay casos. */
export function intervaloWilson(
  exitos: number,
  total: number,
): IntervaloWilson | null {
  if (total <= 0) return null;
  const p = exitos / total;
  const z2 = Z_95 * Z_95;
  const denominador = 1 + z2 / total;
  const centro = (p + z2 / (2 * total)) / denominador;
  const mitad =
    (Z_95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) /
    denominador;
  return {
    inferior: Math.max(0, centro - mitad),
    superior: Math.min(1, centro + mitad),
  };
}

export const razon = (n: number, d: number): number | null =>
  d === 0 ? null : n / d;

export const media = (valores: readonly number[]): number | null =>
  valores.length === 0
    ? null
    : valores.reduce((a, b) => a + b, 0) / valores.length;

/** Percentil por el método del rango más cercano; `p` de 0 a 1. */
export function percentil(
  valores: readonly number[],
  p: number,
): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return (
    ordenados[
      Math.min(
        ordenados.length - 1,
        Math.max(0, Math.ceil(p * ordenados.length) - 1),
      )
    ] ?? null
  );
}

export interface MarcaPareada {
  id: string;
  tipoCaso: string | null;
  marcaA: boolean;
  marcaB: boolean;
  /** La etiqueta del mensaje: ¿es corrupción? Solo para saber quién acertó en un par discordante. */
  esperadoCorrupcion: boolean;
}

export interface ParDiscordante {
  id: string;
  tipoCaso: string | null;
  /** `SOLO_A`: la marca la puso A y B no; `SOLO_B`: al revés. */
  lado: Lado;
  esperadoCorrupcion: boolean;
  /** Quién coincide con la etiqueta. */
  acierta: "A" | "B";
}

/** Pares donde A y B dan una marca distinta, con su lado. Sin textos. */
export function paresDiscordantes(
  pares: readonly MarcaPareada[],
): ParDiscordante[] {
  return pares
    .filter((p) => p.marcaA !== p.marcaB)
    .map((p) => ({
      id: p.id,
      tipoCaso: p.tipoCaso,
      lado: p.marcaA ? Lado.SOLO_A : Lado.SOLO_B,
      esperadoCorrupcion: p.esperadoCorrupcion,
      acierta: p.marcaA === p.esperadoCorrupcion ? "A" : "B",
    }));
}

/** Proporción de pares con la misma marca. `null` sin pares. */
export const acuerdoDeMarcas = (
  pares: readonly MarcaPareada[],
): number | null =>
  razon(pares.filter((p) => p.marcaA === p.marcaB).length, pares.length);

/** Lo que el veredicto necesita de una comparación sobre un conjunto. Razones de 0 a 1; latencias en ms; `null` si no hay dato. */
export interface MedidasParaCriterios {
  /** Q1 absoluto: recall de B con reglas + modelo (con el piso) sobre todo lo que B midió. */
  recallB: number | null;
  recallParesA: number | null;
  recallParesB: number | null;
  /** Q2 absoluto: tasa de falsos positivos de B sobre los negativos. */
  fpB: number | null;
  fpParesA: number | null;
  fpParesB: number | null;
  /** Q3: acuerdo entre A y B en la marca del modelo (`posible_corrupcion`). */
  acuerdoMarca: number | null;
  exactitudParesA: number | null;
  exactitudParesB: number | null;
  /** Q4 absoluto: acuerdo de B entre queja y reclamo con la etiqueta. */
  acuerdoQuejaReclamoB: number | null;
  /** Q5: JSON válido al primer intento de B. */
  jsonPrimerIntentoB: number | null;
  /** S1 y S2: latencias de B sin la primera llamada de la corrida. */
  latenciaMediaB: number | null;
  p90B: number | null;
  latenciaMediaParesA: number | null;
  latenciaMediaParesB: number | null;
}

export interface Subcondicion {
  nombre: string;
  valor: number | null;
  umbral: number;
  cumple: boolean;
  /** Puntos porcentuales que faltan para cumplir (0 si cumple); `null` sin dato. Solo para razones, no para latencias. */
  faltaPuntos: number | null;
}

export interface ResultadoCriterio {
  id: string;
  cumple: boolean;
  /** La mayor falta, en puntos porcentuales, entre las subcondiciones que fallan; `null` si falta un dato. */
  faltaPuntos: number | null;
  subcondiciones: Subcondicion[];
}

const puntos = (razonDeUno: number): number => razonDeUno * PUNTOS_PORCENTUALES;
const redondearPuntos = (valor: number): number =>
  Math.round(valor * 1000) / 1000;

/** `valor ≥ umbral` (la falta se mide en puntos). */
export function minimo(
  nombre: string,
  valor: number | null,
  umbral: number,
  enPuntos = true,
): Subcondicion {
  if (valor === null)
    return { nombre, valor, umbral, cumple: false, faltaPuntos: null };
  const cumple = valor + EPSILON >= umbral;
  return {
    nombre,
    valor,
    umbral,
    cumple,
    faltaPuntos: cumple
      ? 0
      : redondearPuntos(enPuntos ? puntos(umbral - valor) : umbral - valor),
  };
}

/** `valor ≤ umbral`. */
export function maximo(
  nombre: string,
  valor: number | null,
  umbral: number,
  enPuntos = true,
): Subcondicion {
  if (valor === null)
    return { nombre, valor, umbral, cumple: false, faltaPuntos: null };
  const cumple = valor <= umbral + EPSILON;
  return {
    nombre,
    valor,
    umbral,
    cumple,
    faltaPuntos: cumple
      ? 0
      : redondearPuntos(enPuntos ? puntos(valor - umbral) : valor - umbral),
  };
}

export const diferencia = (
  a: number | null,
  b: number | null,
): number | null => (a === null || b === null ? null : a - b);

export const criterio = (
  id: string,
  subcondiciones: Subcondicion[],
): ResultadoCriterio => {
  const faltas = subcondiciones.filter((s) => !s.cumple);
  return {
    id,
    cumple: faltas.length === 0,
    faltaPuntos: faltas.some((s) => s.faltaPuntos === null)
      ? null
      : faltas.length === 0
        ? 0
        : Math.max(...faltas.map((s) => s.faltaPuntos ?? 0)),
    subcondiciones,
  };
};

/** Evalúa Q1 a Q5, S1 y S2 con los umbrales de la sección 21 sobre un conjunto. Función pura. */
export function evaluarCriterios(m: MedidasParaCriterios): ResultadoCriterio[] {
  const u = UMBRALES_SECCION_21;
  const veces =
    m.latenciaMediaParesA === null ||
    m.latenciaMediaParesB === null ||
    m.latenciaMediaParesB === 0
      ? null
      : m.latenciaMediaParesA / m.latenciaMediaParesB;
  return [
    criterio(IdCriterio.Q1, [
      minimo("recall de B (reglas + modelo)", m.recallB, u.Q1_RECALL_MINIMO),
      minimo(
        "recall de B menos recall de A, por pares",
        diferencia(m.recallParesB, m.recallParesA),
        -u.Q1_CAIDA_MAXIMA_FRENTE_A_A,
      ),
    ]),
    criterio(IdCriterio.Q2, [
      maximo("falsos positivos de B sobre negativos", m.fpB, u.Q2_FP_MAXIMO),
      maximo(
        "FP de B menos FP de A, por pares",
        diferencia(m.fpParesB, m.fpParesA),
        u.Q2_SUBIDA_MAXIMA_FRENTE_A_A,
      ),
    ]),
    criterio(IdCriterio.Q3, [
      minimo(
        "acuerdo en la marca de corrupción",
        m.acuerdoMarca,
        u.Q3_ACUERDO_MARCA_MINIMO,
      ),
    ]),
    criterio(IdCriterio.Q4, [
      minimo(
        "exactitud de B menos exactitud de A, por pares",
        diferencia(m.exactitudParesB, m.exactitudParesA),
        -u.Q4_CAIDA_EXACTITUD_MAXIMA_FRENTE_A_A,
      ),
      minimo(
        "acuerdo de B entre queja y reclamo",
        m.acuerdoQuejaReclamoB,
        u.Q4_ACUERDO_QUEJA_RECLAMO_MINIMO,
      ),
    ]),
    criterio(IdCriterio.Q5, [
      minimo(
        "JSON válido al primer intento",
        m.jsonPrimerIntentoB,
        u.Q5_JSON_PRIMER_INTENTO_MINIMO,
      ),
    ]),
    criterio(IdCriterio.S1, [
      maximo(
        "latencia media de B (ms)",
        m.latenciaMediaB,
        u.S1_LATENCIA_MEDIA_MAXIMA_MS,
        false,
      ),
      minimo(
        "veces más rápida que A",
        veces,
        u.S1_VECES_MAS_RAPIDA_QUE_A,
        false,
      ),
    ]),
    criterio(IdCriterio.S2, [
      maximo("percentil 90 de B (ms)", m.p90B, u.S2_P90_MAXIMO_MS, false),
    ]),
  ];
}

/**
 * Combina los criterios de varios conjuntos (desarrollo y prueba): uno cumple solo si cumple en TODOS los conjuntos y su falta es la mayor.
 * La sección 21 exige Q1 en los dos; para el resto aplica la lectura estricta, que no puede favorecer a V2C.
 */
export function combinarCriterios(
  porConjunto: readonly (readonly ResultadoCriterio[])[],
  ids: readonly string[] = Object.values(IdCriterio),
): ResultadoCriterio[] {
  return ids.map((id) => {
    const todos = porConjunto
      .map((criterios) => criterios.find((c) => c.id === id))
      .filter((c): c is ResultadoCriterio => c !== undefined);
    const faltas = todos.filter((c) => !c.cumple);
    return {
      id,
      cumple: todos.length > 0 && faltas.length === 0,
      faltaPuntos: faltas.some((c) => c.faltaPuntos === null)
        ? null
        : faltas.length === 0
          ? 0
          : Math.max(...faltas.map((c) => c.faltaPuntos ?? 0)),
      subcondiciones: todos.flatMap((c) => c.subcondiciones),
    };
  });
}

export interface ResultadoVeredicto {
  veredicto: Veredicto;
  /** Qué criterios fallan y por cuánto. */
  motivo: string;
  /** `true` si el caso cae en un hueco del texto de la sección 21 (se resuelve del lado prudente: No viable). */
  casoNoPrevistoPorLaSeccion: boolean;
}

const fallan = (
  criterios: readonly ResultadoCriterio[],
  ids: readonly string[],
): ResultadoCriterio[] =>
  criterios.filter((c) => ids.includes(c.id) && !c.cumple);

const CRITERIOS_DE_VELOCIDAD: readonly string[] = [
  IdCriterio.S1,
  IdCriterio.S2,
];

const describirFalta = (c: ResultadoCriterio): string => {
  if (c.faltaPuntos === null) return `${c.id} (sin dato)`;
  // La falta de los criterios de velocidad está en milisegundos o en veces, no en puntos porcentuales.
  if (CRITERIOS_DE_VELOCIDAD.includes(c.id)) return c.id;
  return c.faltaPuntos > 0 ? `${c.id} (falta ${c.faltaPuntos} puntos)` : c.id;
};

/**
 * Veredicto de la sección 21:
 * - Viable: cumple Q1 a Q5 y S1 y S2.
 * - Viable con reservas: cumple Q1 y Q5 y falla por poco (menos de 2 puntos) en Q2, Q3 o Q4.
 * - No viable: falla Q1, o falla Q5, o falla más de un criterio de Q2 a Q4.
 * Huecos del texto, resueltos como No viable y marcados: fallar un solo criterio de Q2 a Q4 por 2 puntos o más, o fallar S1 o S2.
 */
export function decidirVeredicto(
  criterios: readonly ResultadoCriterio[],
): ResultadoVeredicto {
  const u = UMBRALES_SECCION_21;
  const q1q5 = fallan(criterios, [IdCriterio.Q1, IdCriterio.Q5]);
  const q2q4 = fallan(criterios, [IdCriterio.Q2, IdCriterio.Q3, IdCriterio.Q4]);
  const velocidad = fallan(criterios, [IdCriterio.S1, IdCriterio.S2]);

  if (q1q5.length > 0)
    return {
      veredicto: Veredicto.NO_VIABLE,
      motivo: `Falla ${q1q5.map(describirFalta).join(", ")}.`,
      casoNoPrevistoPorLaSeccion: false,
    };
  if (q2q4.length > 1)
    return {
      veredicto: Veredicto.NO_VIABLE,
      motivo: `Falla más de un criterio de Q2 a Q4: ${q2q4.map(describirFalta).join(", ")}.`,
      casoNoPrevistoPorLaSeccion: false,
    };
  const unico = q2q4[0];
  if (unico) {
    const porPoco =
      unico.faltaPuntos !== null && unico.faltaPuntos < u.POR_POCO_PUNTOS;
    if (!porPoco)
      return {
        veredicto: Veredicto.NO_VIABLE,
        motivo: `Falla ${describirFalta(unico)}: no es «por poco» (menos de ${u.POR_POCO_PUNTOS} puntos). La sección 21 no prevé este caso; se resuelve como No viable.`,
        casoNoPrevistoPorLaSeccion: true,
      };
    if (velocidad.length > 0)
      return {
        veredicto: Veredicto.NO_VIABLE,
        motivo: `Falla por poco ${describirFalta(unico)} y además la velocidad (${velocidad.map(describirFalta).join(", ")}). La sección 21 no prevé este caso; se resuelve como No viable.`,
        casoNoPrevistoPorLaSeccion: true,
      };
    return {
      veredicto: Veredicto.VIABLE_CON_RESERVAS,
      motivo: `Cumple Q1 y Q5 y falla por poco ${describirFalta(unico)}.`,
      casoNoPrevistoPorLaSeccion: false,
    };
  }
  if (velocidad.length > 0)
    return {
      veredicto: Veredicto.NO_VIABLE,
      motivo: `Cumple Q1 a Q5 pero falla la velocidad (${velocidad.map(describirFalta).join(", ")}). La sección 21 no prevé este caso; se resuelve como No viable.`,
      casoNoPrevistoPorLaSeccion: true,
    };
  return {
    veredicto: Veredicto.VIABLE,
    motivo: "Cumple Q1 a Q5, S1 y S2.",
    casoNoPrevistoPorLaSeccion: false,
  };
}
