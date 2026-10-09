import { TipoSenal } from "@/enums/filtro-corrupcion.enum.js";

/**
 * v1.1: el filtro usa el catálogo oficial de entidades y titulares (detecta entidad, titular y referencia de derivación).
 * v1.2: patrones generalizables de cobro (verbo × objeto × complemento), negación del cobro, zona gris (`requiereSegundaOpinion`),
 * señal sensible de acoso y destino especial `st-pad-minsa`.
 */
export const VERSION_REGLAS_CORRUPCION = "reglas-corrupcion-v1.2";

/** Código de destino especial (no es una entidad del catálogo): la Secretaría Técnica del PAD del MINSA. */
export const CODIGO_DESTINO_ST_PAD_MINSA = "st-pad-minsa";

/** En el texto normalizado, un monto de dinero ("50 soles", "s/ 20") se reemplaza por esta palabra: sirve de objeto del cobro. */
export const PALABRA_DE_MONTO = "monto";

/** Cuántas palabras antes de una frase de cobro se miran para ver si la niegan ("no me pidió plata", "nadie me cobró"). */
export const VENTANA_DE_NEGACION = 2;

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

/**
 * Combinación de las reglas con el modelo (decisión del 2026-10-08): el modelo no decide, aporta un peso entero de 0 a
 * `PESO_MAXIMO_IA` que se SUMA al puntaje de las reglas.
 */
export const PESO_MAXIMO_IA = 10;

/** El total (reglas + peso del modelo) debe SUPERAR este valor para proponer corrupción cuando las reglas solas no la proponían. Valor inicial: se calibra en F4. */
export const UMBRAL_TOTAL_CORRUPCION = 5;

/** Desde este peso se considera que el modelo ve corrupción; hasta `PESO_IA_DESCARTA_CORRUPCION` la descarta. Entre los dos no opina claro. */
export const PESO_IA_VE_CORRUPCION = 5;
export const PESO_IA_DESCARTA_CORRUPCION = 2;

/** La confianza nunca llega a 100 (plan de PoC, sección 6). */
export const TOPE_CONFIANZA = 95;

/** Bandas de confianza en porcentaje (plan de PoC, sección 6): punto de partida, se calibran con el set de evaluación. */
export const BANDAS_DE_CONFIANZA = {
  COINCIDEN_FUERTE: { minimo: 80, maximo: TOPE_CONFIANZA },
  COINCIDEN_DEBIL: { minimo: 65, maximo: 80 },
  SOLO_UNO: { minimo: 45, maximo: 65 },
  DISCREPAN: { minimo: 30, maximo: 50 },
} as const;
