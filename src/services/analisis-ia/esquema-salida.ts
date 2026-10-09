import { z } from "zod";
import {
  ALTERNATIVAS_MAXIMAS,
  CARGO_MAXIMO_CARACTERES,
  EXPLICACION_MAXIMA_CARACTERES,
  FRASE_MAXIMA_CARACTERES,
  INFORMACION_FALTANTE_MAXIMA,
  SENALES_MAXIMAS,
} from "@/constants/analisis-ia.js";
import { PESO_MAXIMO_IA } from "@/constants/filtro-corrupcion.js";
import {
  FormatoSalidaIa,
  InformacionFaltanteIa,
  TipoSenalModelo,
} from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { normalizarPesoIa } from "@/services/filtro-corrupcion/combinar-reglas-con-ia.js";

const CATEGORIAS = Object.values(CategoriaIncidencia) as [
  CategoriaIncidencia,
  ...CategoriaIncidencia[],
];
const TIPOS_DE_SENAL = Object.values(TipoSenalModelo) as [
  TipoSenalModelo,
  ...TipoSenalModelo[],
];
const FALTANTES = Object.values(InformacionFaltanteIa) as [
  InformacionFaltanteIa,
  ...InformacionFaltanteIa[],
];

/**
 * Salida del modelo. El orden de los campos importa: Ollama genera en el orden del esquema, y la categoría y el peso salen
 * antes que el resto para que, si se corta la salida, lo decisivo ya esté escrito.
 */
export const esquemaSalidaModelo = z.object({
  categoria: z.enum(CATEGORIAS),
  peso_corrupcion: z.number().int().min(0).max(PESO_MAXIMO_IA),
  posible_corrupcion: z.boolean(),
  alternativas: z
    .array(
      z.object({
        categoria: z.enum(CATEGORIAS),
        probabilidad: z.number().min(0).max(1),
      }),
    )
    .max(ALTERNATIVAS_MAXIMAS),
  senales: z
    .array(
      z.object({
        frase: z.string().max(FRASE_MAXIMA_CARACTERES),
        tipo: z.enum(TIPOS_DE_SENAL),
      }),
    )
    .max(SENALES_MAXIMAS),
  actor: z.object({
    cargo: z.string().max(CARGO_MAXIMO_CARACTERES).nullable(),
    nombre_mencionado: z.string().max(CARGO_MAXIMO_CARACTERES).nullable(),
  }),
  informacion_faltante: z
    .array(z.enum(FALTANTES))
    .max(INFORMACION_FALTANTE_MAXIMA),
  /** Máximo dos frases: lo pide el prompt; aquí solo se acota el largo. */
  explicacion: z.string().max(EXPLICACION_MAXIMA_CARACTERES),
});

export type SalidaModelo = z.infer<typeof esquemaSalidaModelo>;

/**
 * Salida compacta (V2C): solo lo que decide. Es lo que el modelo escribe en ~38 tokens (~3 s) en lugar de ~215 (~15 s). La explicación,
 * las señales, la información faltante y la ficha las arman las reglas con plantillas (`plantillas-paquete.ts`).
 */
export const esquemaSalidaCompacta = z.object({
  categoria: z.enum(CATEGORIAS),
  peso_corrupcion: z.number().int().min(0).max(PESO_MAXIMO_IA),
  posible_corrupcion: z.boolean(),
});

export type SalidaCompacta = z.infer<typeof esquemaSalidaCompacta>;

/** Lo que puede devolver el cliente: la salida completa (V1 a V3) o la compacta (V2C). La completa incluye los tres campos de la compacta. */
export type SalidaIa = SalidaCompacta | SalidaModelo;

/** `true` si la salida trae los campos de la completa (explicación, señales, alternativas...). */
export const esSalidaCompleta = (salida: SalidaIa): salida is SalidaModelo =>
  "explicacion" in salida;

function aJsonSchema(esquema: z.ZodType): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = {
    ...z.toJSONSchema(esquema, { target: "draft-7" }),
  };
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** El mismo esquema en formato JSON Schema, para el campo `format` de Ollama (salida estructurada). Sin `$schema`. */
export function esquemaSalidaJson(): Record<string, unknown> {
  return aJsonSchema(esquemaSalidaModelo);
}

/** El esquema compacto en JSON Schema (enum de categorías, entero de 0 a 10 y booleano) para el campo `format` de Ollama. */
export function esquemaSalidaCompactaJson(): Record<string, unknown> {
  return aJsonSchema(esquemaSalidaCompacta);
}

/** El JSON Schema que corresponde a cada formato de salida. */
export function esquemaJsonPorFormato(
  formato: FormatoSalidaIa,
): Record<string, unknown> {
  return formato === FormatoSalidaIa.COMPACTA
    ? esquemaSalidaCompactaJson()
    : esquemaSalidaJson();
}

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

const acotarProbabilidad = (valor: unknown): unknown =>
  typeof valor === "number" && Number.isFinite(valor)
    ? Math.min(1, Math.max(0, valor))
    : valor;

const recortarLista = (valor: unknown, maximo: number): unknown =>
  Array.isArray(valor) ? valor.slice(0, maximo) : valor;

/**
 * Tolerancia antes de validar: un peso fuera de rango se recorta (y un decimal se redondea) como en `combinarReglasConIa`, una
 * probabilidad fuera de 0 a 1 se acota y las listas y la explicación demasiado largas se cortan. Así un exceso sin importancia no
 * gasta el reintento (cada llamada cuesta varios segundos). Lo que no es un objeto o no cumple el esquema sigue siendo inválido.
 */
export function normalizarSalidaCruda(cruda: unknown): unknown {
  if (!esRegistro(cruda)) return cruda;
  const peso =
    typeof cruda.peso_corrupcion === "number"
      ? normalizarPesoIa(cruda.peso_corrupcion)
      : cruda.peso_corrupcion;
  const alternativas = Array.isArray(cruda.alternativas)
    ? recortarLista(
        cruda.alternativas.map((alternativa: unknown) =>
          esRegistro(alternativa)
            ? {
                ...alternativa,
                probabilidad: acotarProbabilidad(alternativa.probabilidad),
              }
            : alternativa,
        ),
        ALTERNATIVAS_MAXIMAS,
      )
    : cruda.alternativas;
  return {
    ...cruda,
    peso_corrupcion: peso,
    alternativas,
    senales: recortarLista(cruda.senales, SENALES_MAXIMAS),
    informacion_faltante: recortarLista(
      cruda.informacion_faltante,
      INFORMACION_FALTANTE_MAXIMA,
    ),
    explicacion:
      typeof cruda.explicacion === "string"
        ? cruda.explicacion.slice(0, EXPLICACION_MAXIMA_CARACTERES)
        : cruda.explicacion,
  };
}

/** Tolerancia de la salida compacta: solo el peso se recorta (a 0..10) y un decimal se redondea. */
export function normalizarSalidaCompactaCruda(cruda: unknown): unknown {
  if (!esRegistro(cruda)) return cruda;
  return {
    ...cruda,
    peso_corrupcion:
      typeof cruda.peso_corrupcion === "number"
        ? normalizarPesoIa(cruda.peso_corrupcion)
        : cruda.peso_corrupcion,
  };
}

export type ResultadoValidacion =
  { ok: true; salida: SalidaModelo } | { ok: false };

export type ResultadoValidacionCompacta =
  { ok: true; salida: SalidaCompacta } | { ok: false };

/** Valida una salida ya convertida de JSON (con la tolerancia de `normalizarSalidaCruda`). */
export function validarSalidaModelo(cruda: unknown): ResultadoValidacion {
  const analisis = esquemaSalidaModelo.safeParse(normalizarSalidaCruda(cruda));
  return analisis.success ? { ok: true, salida: analisis.data } : { ok: false };
}

/** Valida una salida compacta ya convertida de JSON (con la tolerancia de `normalizarSalidaCompactaCruda`). */
export function validarSalidaCompacta(
  cruda: unknown,
): ResultadoValidacionCompacta {
  const analisis = esquemaSalidaCompacta.safeParse(
    normalizarSalidaCompactaCruda(cruda),
  );
  return analisis.success ? { ok: true, salida: analisis.data } : { ok: false };
}

/** Valida según el formato pedido. */
export function validarSalidaPorFormato(
  formato: FormatoSalidaIa,
  cruda: unknown,
): { ok: true; salida: SalidaIa } | { ok: false } {
  return formato === FormatoSalidaIa.COMPACTA
    ? validarSalidaCompacta(cruda)
    : validarSalidaModelo(cruda);
}
