import {
  BANDAS_DE_CONFIANZA,
  PESO_IA_DESCARTA_CORRUPCION,
  PESO_IA_VE_CORRUPCION,
  PESO_MAXIMO_IA,
  TOPE_CONFIANZA,
  UMBRAL_CERTEZA_MEDIA,
  UMBRAL_TOTAL_CORRUPCION,
} from "@/constants/filtro-corrupcion.js";
import { AcuerdoReglasIa, CertezaCorrupcion } from "@/enums/filtro-corrupcion.enum.js";
import type { ResultadoCombinacion, ResultadoCorrupcion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

type Banda = { readonly minimo: number; readonly maximo: number };

const PESO_IA_FUERTE = 7;

const acotar = (valor: number, minimo = 0, maximo = 1): number => Math.min(maximo, Math.max(minimo, valor));

/**
 * Peso del modelo ya usable: un entero de 0 a `PESO_MAXIMO_IA`. Un valor fuera de rango se recorta a la orilla, un decimal se
 * redondea al entero más cercano, y lo que no es un número (el modelo no respondió o respondió basura) cuenta como "sin modelo".
 */
export function normalizarPesoIa(peso: number | null | undefined): number | null {
  if (peso === null || peso === undefined || Number.isNaN(peso)) return null;
  return acotar(Math.round(peso), 0, PESO_MAXIMO_IA);
}

/** Un punto de la banda: `posicion` 0 es el mínimo y 1 el máximo. Nunca pasa del tope de confianza ni llega a 100. */
function dentroDeLaBanda(banda: Banda, posicion: number): number {
  const valor = banda.minimo + acotar(posicion) * (banda.maximo - banda.minimo);
  return Math.round(Math.min(valor, TOPE_CONFIANZA) * 100) / 100;
}

interface Confianza {
  acuerdo: AcuerdoReglasIa;
  confianza: number;
}

/** Fuerza de la señal de las reglas cuando proponen corrupción: 0 en el umbral medio, 1 con cinco puntos más. */
const fuerzaDeReglasQueVen = (puntaje: number): number => acotar((puntaje - UMBRAL_CERTEZA_MEDIA) / 5);

/** Confianza solo con reglas, porque el modelo no estuvo disponible: siempre en la banda de "solo uno". */
function confianzaSinModelo(reglas: ResultadoCorrupcion): Confianza {
  const posicion = reglas.propuestaCorrupcion
    ? fuerzaDeReglasQueVen(reglas.puntaje)
    : reglas.requiereSegundaOpinion
      ? 0
      : acotar((UMBRAL_CERTEZA_MEDIA - 1 - reglas.puntaje) / 3);
  return { acuerdo: AcuerdoReglasIa.SIN_MODELO, confianza: dentroDeLaBanda(BANDAS_DE_CONFIANZA.SOLO_UNO, posicion) };
}

/** Confianza según el acuerdo entre las reglas y el modelo (plan de PoC, sección 6). */
function confianzaPorAcuerdo(reglas: ResultadoCorrupcion, pesoIa: number, propuestaFinal: boolean): Confianza {
  const reglasVen = reglas.propuestaCorrupcion;
  const iaVe = pesoIa >= PESO_IA_VE_CORRUPCION;
  const iaDescarta = pesoIa <= PESO_IA_DESCARTA_CORRUPCION;
  const reglasDescartan = !reglasVen && reglas.puntaje <= 0;

  if (reglasVen && iaVe) {
    const fuerte = reglas.certeza === CertezaCorrupcion.ALTA && pesoIa >= PESO_IA_FUERTE;
    const posicion =
      (fuerzaDeReglasQueVen(reglas.puntaje) + (pesoIa - PESO_IA_VE_CORRUPCION) / (PESO_MAXIMO_IA - PESO_IA_VE_CORRUPCION)) / 2;
    return {
      acuerdo: AcuerdoReglasIa.COINCIDEN,
      confianza: dentroDeLaBanda(fuerte ? BANDAS_DE_CONFIANZA.COINCIDEN_FUERTE : BANDAS_DE_CONFIANZA.COINCIDEN_DEBIL, posicion),
    };
  }

  if (!reglasVen && !iaVe) {
    // Ninguno ve corrupción por separado. Si aun así la suma pasó el umbral, ninguno bastaba solo: es un acuerdo parcial.
    if (propuestaFinal) return { acuerdo: AcuerdoReglasIa.SOLO_UNO, confianza: dentroDeLaBanda(BANDAS_DE_CONFIANZA.SOLO_UNO, 0) };
    const fuerte = reglasDescartan && iaDescarta;
    const posicion = (acotar((UMBRAL_CERTEZA_MEDIA - 1 - reglas.puntaje) / 3) + acotar((PESO_IA_DESCARTA_CORRUPCION + 1 - pesoIa) / 3)) / 2;
    return {
      acuerdo: AcuerdoReglasIa.COINCIDEN,
      confianza: dentroDeLaBanda(fuerte ? BANDAS_DE_CONFIANZA.COINCIDEN_FUERTE : BANDAS_DE_CONFIANZA.COINCIDEN_DEBIL, posicion),
    };
  }

  if (reglasVen && iaDescarta)
    return { acuerdo: AcuerdoReglasIa.DISCREPAN, confianza: dentroDeLaBanda(BANDAS_DE_CONFIANZA.DISCREPAN, 0.5) };
  if (!reglasVen && iaVe && reglasDescartan)
    return { acuerdo: AcuerdoReglasIa.DISCREPAN, confianza: dentroDeLaBanda(BANDAS_DE_CONFIANZA.DISCREPAN, 0.5) };

  // Solo uno ve corrupción y el otro no dice lo contrario.
  const posicion = reglasVen
    ? fuerzaDeReglasQueVen(reglas.puntaje)
    : (pesoIa - PESO_IA_VE_CORRUPCION) / (PESO_MAXIMO_IA - PESO_IA_VE_CORRUPCION);
  return { acuerdo: AcuerdoReglasIa.SOLO_UNO, confianza: dentroDeLaBanda(BANDAS_DE_CONFIANZA.SOLO_UNO, posicion) };
}

/**
 * Combina el resultado de las reglas con el peso del modelo (decisión del 2026-10-08, plan de PoC sección 13). El modelo NO
 * decide: su peso (entero de 0 a `PESO_MAXIMO_IA`) se SUMA al puntaje de las reglas y, si el total supera
 * `UMBRAL_TOTAL_CORRUPCION`, se propone corrupción. El modelo puede SUBIR un caso a corrupción, pero nunca bajar uno que las reglas ya
 * propusieron. Con `pesoIa` null (modelo no disponible) solo valen las reglas, y si estas dejaron una duda (zona gris) el caso va a
 * revisión de OTRANS: ante la duda, OTRANS. La confianza se deriva del acuerdo y nunca llega a 100. Función pura.
 */
export function combinarReglasConIa(reglas: ResultadoCorrupcion, pesoIa: number | null | undefined): ResultadoCombinacion {
  const peso = normalizarPesoIa(pesoIa);
  const puntajeTotal = reglas.puntaje + (peso ?? 0);
  const subidaPorIa = !reglas.propuestaCorrupcion && peso !== null && puntajeTotal > UMBRAL_TOTAL_CORRUPCION;
  const propuestaCorrupcion = reglas.propuestaCorrupcion || subidaPorIa;
  const { acuerdo, confianza } = peso === null ? confianzaSinModelo(reglas) : confianzaPorAcuerdo(reglas, peso, propuestaCorrupcion);
  const dudaSinModelo = reglas.requiereSegundaOpinion && peso === null;
  const revisionOtrans = propuestaCorrupcion || dudaSinModelo;

  return {
    propuestaCorrupcion,
    puntajeReglas: reglas.puntaje,
    pesoIa: peso,
    puntajeTotal,
    umbral: UMBRAL_TOTAL_CORRUPCION,
    subidaPorIa,
    acuerdo,
    confianza,
    requiereOtrans: propuestaCorrupcion,
    revisionOtrans,
    requiereRevisionHumana: revisionOtrans || acuerdo === AcuerdoReglasIa.DISCREPAN,
  };
}

/** Se reexporta aquí para quien llame a la combinación: el modelo debe entregar un entero de 0 a este valor. */
export { PESO_MAXIMO_IA };
