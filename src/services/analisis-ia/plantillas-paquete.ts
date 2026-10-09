import {
  InformacionFaltanteIa,
  OrigenFundamento,
} from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import {
  FaltanteCorrupcion,
  OrigenPropuesta,
  SenalSensible,
} from "@/enums/filtro-corrupcion.enum.js";
import type { Fundamento } from "@/services/analisis-ia/analisis-ia.types.js";
import type { SalidaCompacta } from "@/services/analisis-ia/esquema-salida.js";
import type {
  ResultadoCombinacion,
  ResultadoCorrupcion,
} from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

/**
 * Plantillas deterministas del paquete de V2C. Con la salida compacta el modelo ya no entrega explicación, señales, actor, información
 * faltante ni alternativas: todo eso sale de las reglas y de los tres campos del modelo, sin inventar nada que no esté en ellos. Funciones
 * puras: la misma entrada da siempre la misma salida.
 */

/** Cuántas frases de las reglas se citan en la explicación. */
const SENALES_MAXIMAS_EN_EXPLICACION = 3;

const FALTANTE_DE_REGLAS: Readonly<
  Record<FaltanteCorrupcion, InformacionFaltanteIa>
> = {
  [FaltanteCorrupcion.DATOS_INSUFICIENTES]:
    InformacionFaltanteIa.HECHO_DETALLADO,
  [FaltanteCorrupcion.AUTOR_O_CARGO]: InformacionFaltanteIa.AUTOR_O_CARGO,
  [FaltanteCorrupcion.ENTIDAD]: InformacionFaltanteIa.ENTIDAD_O_UNIDAD,
  [FaltanteCorrupcion.PRUEBAS]: InformacionFaltanteIa.PRUEBAS,
};

const NOMBRE_DE_CATEGORIA: Readonly<Record<CategoriaIncidencia, string>> = {
  [CategoriaIncidencia.DENUNCIA_CORRUPCION]: "denuncia de corrupción",
  [CategoriaIncidencia.QUEJA]: "queja",
  [CategoriaIncidencia.RECLAMO]: "reclamo",
  [CategoriaIncidencia.OTRO]: "otro",
};

/** Información faltante: los requisitos que las reglas ya calculan (hecho detallado, autor o cargo, entidad o unidad, pruebas). */
export const informacionFaltanteDeReglas = (
  reglas: ResultadoCorrupcion,
): InformacionFaltanteIa[] =>
  reglas.faltantes.map((f) => FALTANTE_DE_REGLAS[f]);

/** Fundamentos: las señales que encontraron las reglas (frase normalizada y tipo). */
export const fundamentosDeReglas = (
  reglas: ResultadoCorrupcion,
): Fundamento[] =>
  reglas.senales.map((s) => ({
    origen: OrigenFundamento.REGLAS,
    frase: s.frase,
    tipo: s.tipo,
  }));

const plural = (
  cantidad: number,
  singular: string,
  pluralTexto: string,
): string => `${cantidad} ${cantidad === 1 ? singular : pluralTexto}`;

function fraseDeReglas(reglas: ResultadoCorrupcion): string {
  const frases = reglas.senales
    .slice(0, SENALES_MAXIMAS_EN_EXPLICACION)
    .map((s) => `"${s.frase}"`);
  const base =
    reglas.senales.length === 0
      ? "Las reglas no encontraron señales de corrupción (0 puntos)"
      : `Las reglas suman ${plural(reglas.puntaje, "punto", "puntos")} con ${plural(reglas.senales.length, "señal", "señales")} (${frases.join(", ")}${reglas.senales.length > frases.length ? ", ..." : ""})`;
  const detalles: string[] = [];
  if (reglas.entidad)
    detalles.push(`entidad detectada: ${reglas.entidad.nombre}`);
  if (reglas.titular)
    detalles.push(
      `titular mencionado: ${reglas.titular.cargo}${reglas.titular.nombreCoincide ? " (el nombre coincide con el del catálogo)" : ""}`,
    );
  else if (reglas.actor)
    detalles.push(`cargo mencionado: ${reglas.actor.cargo}`);
  return detalles.length > 0 ? `${base}; ${detalles.join("; ")}` : base;
}

function fraseDelModelo(salida: SalidaCompacta | null): string {
  if (!salida) return "El modelo no estuvo disponible";
  return `El modelo propone ${NOMBRE_DE_CATEGORIA[salida.categoria]} con peso ${salida.peso_corrupcion} de 10${salida.posible_corrupcion ? " y marca posible corrupción" : ""}`;
}

function fraseDeOtrans(
  reglas: ResultadoCorrupcion,
  salida: SalidaCompacta | null,
  combinacion: ResultadoCombinacion,
  revisionOtrans: boolean,
): string {
  const totales = `total ${combinacion.puntajeTotal}, umbral ${combinacion.umbral}`;
  if (combinacion.propuestaCorrupcion) {
    if (reglas.propuestaCorrupcion)
      return reglas.origenPropuesta === OrigenPropuesta.IDENTIDAD
        ? "se propone OTRANS porque las reglas la proponen por identidad (entidad o titular con un indicio de cobro)"
        : "se propone OTRANS porque las reglas la proponen";
    return `se propone OTRANS porque el peso del modelo lleva el total sobre el umbral (${totales})`;
  }
  if (revisionOtrans)
    return salida &&
      (salida.posible_corrupcion ||
        salida.categoria === CategoriaIncidencia.DENUNCIA_CORRUPCION)
      ? `OTRANS debe revisarlo por duda: el modelo sospecha corrupción pero el total no supera el umbral (${totales})`
      : "OTRANS debe revisarlo por duda: las reglas piden una segunda opinión y el modelo no estuvo disponible";
  return `no se propone OTRANS (${totales})`;
}

export interface EntradaExplicacion {
  reglas: ResultadoCorrupcion;
  salida: SalidaCompacta | null;
  combinacion: ResultadoCombinacion;
  /** OTRANS debe mirarlo aunque no se proponga corrupción (duda). */
  revisionOtrans: boolean;
}

/**
 * Explicación por plantilla, en español y en dos frases: la primera resume las reglas (puntaje, señales, entidad, titular o cargo) y la
 * segunda lo que propone el modelo (categoría, peso, marca) y por qué se propone OTRANS o no. No cita el texto del ciudadano más allá de
 * las frases normalizadas de las señales de las reglas.
 */
export function construirExplicacionDeterminista(
  entrada: EntradaExplicacion,
): string {
  const { reglas, salida, combinacion, revisionOtrans } = entrada;
  const otrans = fraseDeOtrans(reglas, salida, combinacion, revisionOtrans);
  const acoso =
    reglas.senalSensible === SenalSensible.ACOSO && reglas.escalarAOtrans
      ? "; además hay acoso contra un cargo mayor y se marca para escalar a OTRANS"
      : "";
  return `${fraseDeReglas(reglas)}. ${fraseDelModelo(salida)}; ${otrans}${acoso}.`;
}
