import {
  TOPE_CONFIANZA_CON_DUDA,
  VERSION_CLASIFICADOR_SIN_MODELO,
} from "@/constants/clasificador.js";
import { TOPE_CONFIANZA } from "@/constants/filtro-corrupcion.js";
import { MotivoDeEscritura } from "@/enums/clasificador.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { OrigenPropuesta } from "@/enums/filtro-corrupcion.enum.js";
import type { PaqueteAnalisis } from "@/services/analisis-ia/analisis-ia.types.js";

/** Lo que el clasificador escribe en `categoria_ia_id` y `categoria_confianza`, y por qué. */
export interface DecisionDeEscritura {
  /** Categoría que se escribe. Con corrupción o duda de corrupción siempre es `DENUNCIA_CORRUPCION`: la base la manda a OTRANS. */
  categoria: CategoriaIncidencia;
  /** Porcentaje de 0 a 95, con dos decimales. Con duda, nunca más de `TOPE_CONFIANZA_CON_DUDA`. */
  confianza: number;
  motivo: MotivoDeEscritura;
  /** Lo que propuso el análisis antes de la regla (en la duda es Reclamo, que la base mandaría a un establecimiento). */
  propuestaDelAnalisis: CategoriaIncidencia;
  /** Acoso contra un cargo mayor: solo se marca; la base no tiene dónde enrutarlo (sección 16 del plan de PoC). */
  escalarAOtrans: boolean;
}

const redondear2 = (valor: number): number => Math.round(valor * 100) / 100;

/** La confianza que se guarda: dos decimales, entre 0 y el tope, y nunca 100. */
const confianzaAcotada = (confianza: number, tope: number): number =>
  redondear2(Math.min(Math.max(confianza, 0), Math.min(tope, TOPE_CONFIANZA)));

function motivoDeCorrupcion(paquete: PaqueteAnalisis): MotivoDeEscritura {
  if (!paquete.reglas.propuestaCorrupcion)
    return MotivoDeEscritura.SUMA_CON_MODELO;
  return paquete.reglas.origenPropuesta === OrigenPropuesta.IDENTIDAD
    ? MotivoDeEscritura.IDENTIDAD
    : MotivoDeEscritura.REGLAS;
}

/**
 * B2, regla de escritura del clasificador (decisión del usuario, 2026-10-09): **la corrupción y la duda de corrupción siempre se
 * escriben como `DENUNCIA_CORRUPCION`**, para que la base las destine a OTRANS y nunca lleguen a un establecimiento. Una persona de
 * OTRANS las corrige después si no lo eran.
 * - Corrupción propuesta (reglas, identidad o suma con el peso del modelo): `DENUNCIA_CORRUPCION` con la confianza del análisis.
 * - Duda (el modelo la sospecha sin alcanzar el umbral, o zona gris sin modelo): `DENUNCIA_CORRUPCION` con confianza de a lo más
 *   `TOPE_CONFIANZA_CON_DUDA`.
 * - Si no: la categoría que propone el análisis, con su confianza.
 * `escalarAOtrans` (acoso contra un cargo mayor) solo se marca. Función pura.
 */
export function decidirEscritura(
  paquete: PaqueteAnalisis,
): DecisionDeEscritura {
  const base = {
    propuestaDelAnalisis: paquete.propuesta,
    escalarAOtrans: paquete.escalarAOtrans,
  };
  if (paquete.requiereOtrans)
    return {
      ...base,
      categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
      confianza: confianzaAcotada(paquete.confianza, TOPE_CONFIANZA),
      motivo: motivoDeCorrupcion(paquete),
    };
  if (paquete.revisionOtrans)
    return {
      ...base,
      categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
      confianza: confianzaAcotada(paquete.confianza, TOPE_CONFIANZA_CON_DUDA),
      motivo:
        paquete.salidaModelo === null
          ? MotivoDeEscritura.DUDA_SIN_MODELO
          : MotivoDeEscritura.DUDA_DEL_MODELO,
    };
  return {
    ...base,
    categoria: paquete.propuesta,
    confianza: confianzaAcotada(paquete.confianza, TOPE_CONFIANZA),
    motivo: MotivoDeEscritura.SIN_CORRUPCION,
  };
}

/**
 * `version_clasificador`: versión de las reglas, modelo y variante (la base no la valida). Sin modelo (texto corto o caída) dice
 * `solo-reglas`. Función pura.
 */
export function construirVersionClasificador(
  paquete: PaqueteAnalisis,
  modelo: string,
  versionSinModelo: string = VERSION_CLASIFICADOR_SIN_MODELO,
): string {
  const usoElModelo =
    paquete.variante !== null && paquete.salidaModelo !== null;
  return [
    paquete.reglas.versionReglas,
    usoElModelo ? modelo : versionSinModelo,
    ...(usoElModelo ? [paquete.variante] : []),
  ].join("+");
}
