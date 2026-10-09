/*
 * Trabajador clasificador (B1) y regla de escritura (B2) del plan de PoC de IA. El bot registra la incidencia y termina; este
 * proceso del backend toma las filas REGISTRADO sin categoría de la IA, las analiza y escribe el resultado.
 */

/**
 * Con duda de corrupción (el modelo la sospecha pero la suma no alcanza, o las reglas piden segunda opinión y no hubo modelo) el caso
 * va igual a OTRANS, pero con confianza baja: este es el tope. Es el mismo que ya aplica `analizarMensaje` a empates y dudas.
 */
export const TOPE_CONFIANZA_CON_DUDA = 55;

/** Una fila sin clasificar por más de estos minutos dispara la alarma (a los 3 días el archivador de vencidos la retiraría). */
export const UMBRAL_ALARMA_SIN_CLASIFICAR_MINUTOS = 10;

/** Cuántos códigos de casos atrasados trae la alarma (solo códigos, nunca textos). */
export const ALARMA_CODIGOS_MAXIMOS = 10;

/** Un caso que falla (error de base o de código, no del modelo, que degrada) se reintenta hasta este número de veces en este proceso. */
export const MAXIMO_INTENTOS_POR_CASO = 3;

/** Cuánto espera el trabajador antes de buscar más casos cuando la cola está vacía. */
export const INTERVALO_SONDEO_MS = 5_000;

/**
 * Tope de una consulta al modelo dentro de la transacción del caso. La fila queda bloqueada mientras el modelo responde, así que se
 * acota a un minuto (por defecto el cliente espera hasta dos): un modelo lento degrada a solo reglas y no deja la transacción abierta.
 */
export const TIEMPO_MAXIMO_MODELO_CLASIFICADOR_MS = 60_000;

/** Parte fija de `version_clasificador` cuando el modelo no se usó (texto corto o caída). */
export const VERSION_CLASIFICADOR_SIN_MODELO = "solo-reglas";
