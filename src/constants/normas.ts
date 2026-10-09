import { TipoSenal } from "@/enums/filtro-corrupcion.enum.js";

/**
 * Leyenda que acompaña a toda cita de la norma. Es una pista de parecido entre el relato y un supuesto de la norma, hecha por
 * el código: no es una calificación jurídica y no decide la categoría, el destino ni la derivación.
 */
export const ETIQUETA_REFERENCIA_ORIENTATIVA =
  "Referencia orientativa; la califica OTRANS.";

/** Texto cuando el caso va a OTRANS y ninguna señal de las reglas coincide con un supuesto del Anexo C. */
export const TEXTO_SIN_SUPUESTO_IDENTIFICADO =
  "No se encontró un supuesto del Anexo C que coincida con las señales detectadas; lo evalúa OTRANS.";

/** Tope de supuestos del Anexo C que se citan por mensaje: más serían ruido para quien revisa. */
export const MAXIMO_SUPUESTOS_CITADOS = 3;

/** Solo estas señales cuentan para citar un supuesto: las de cobro, favor o apropiación, no las de entidad, cargo o ubicación. */
export const SENALES_QUE_PUEDEN_CITAR_UN_SUPUESTO: readonly TipoSenal[] = [
  TipoSenal.FUERTE,
  TipoSenal.MEDIA,
  TipoSenal.DEBIL,
];
