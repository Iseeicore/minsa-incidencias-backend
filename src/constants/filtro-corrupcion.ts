import { TipoSenal } from "@/enums/filtro-corrupcion.enum.js";

/** v1.1: el filtro usa el catálogo oficial de entidades y titulares (detecta entidad, titular y referencia de derivación). */
export const VERSION_REGLAS_CORRUPCION = "reglas-corrupcion-v1.1";

/** Desde este largo (con trim) un texto entra al filtro; menos es "datos insuficientes" (plan de cierre, 3 y 3b). */
export const LONGITUD_MINIMA_TEXTO_CORRUPCION = 20;
export const TEXTO_EVALUACION_MAXIMO = 5000;
export const ENTIDADES_EVALUACION_MAXIMO = 100;

/** Puntos de cada elemento (léxico, sección 2). Valores iniciales: se calibran con frases etiquetadas. */
export const PESO_POR_TIPO: Readonly<Record<TipoSenal, number>> = {
  [TipoSenal.FUERTE]: 3,
  [TipoSenal.MEDIA]: 2,
  [TipoSenal.DEBIL]: 1,
  [TipoSenal.NEGATIVA_DECISIVA]: -2,
  [TipoSenal.NEGATIVA_LEVE]: -1,
  [TipoSenal.ACTOR]: 1,
  [TipoSenal.ENTIDAD]: 1,
};

/** Señales de corrupción propiamente dichas: sin al menos una nunca se propone corrupción. */
export const TIPOS_DE_SENAL_DE_CORRUPCION: readonly TipoSenal[] = [TipoSenal.FUERTE, TipoSenal.MEDIA, TipoSenal.DEBIL];

export const UMBRAL_CERTEZA_ALTA = 4;
export const UMBRAL_CERTEZA_MEDIA = 2;

/** Cuántas palabras cualesquiera puede haber dentro de un hueco `~` de una frase del léxico. */
export const HUECO_MAXIMO_PALABRAS = 3;
export const MARCA_DE_HUECO = "~";

/** Títulos del cargo máximo que NO son "equivalentes": cualquier otro cargo máximo (director ejecutivo, superintendente, ministro...) sí lo es. */
export const TITULOS_ESTANDAR_DEL_CARGO_MAXIMO: ReadonlySet<string> = new Set([
  "director general",
  "directora general",
  "jefe institucional",
  "jefa institucional",
]);

/** Para coincidir con el nombre del titular hacen falta al menos dos palabras seguidas del nombre (un nombre de pila suelto no basta). */
export const PALABRAS_SEGUIDAS_PARA_NOMBRE = 2;
