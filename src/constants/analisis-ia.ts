import { FormatoSalidaIa, VarianteIa } from "@/enums/analisis-ia.enum.js";

/**
 * Parámetros fijos del modelo local. Copian `ia-poc/modelo/parametros.json` (que queda fuera de `src` y por eso no se importa);
 * el script de evaluación lee ese archivo y los pasa como configuración, así que la fuente de verdad de las corridas es el JSON.
 */
export const OLLAMA_URL_POR_DEFECTO = "http://localhost:11434";
export const MODELO_POR_DEFECTO = "qwen3.5-9b-local";
export const OLLAMA_KEEP_ALIVE_POR_DEFECTO = "30m";
export const OLLAMA_OPCIONES_POR_DEFECTO = {
  temperature: 0,
  seed: 7,
  num_ctx: 4096,
} as const;

/** Tiempo máximo de una llamada. La primera llamada en frío tarda unos 2 minutos: precalentar con `ia-poc/scripts/precalentar.mjs`. */
export const TIEMPO_MAXIMO_MODELO_MS = 120_000;
/** Reintentos con el mismo prompt si el JSON no valida o hay un error de red (no se reintenta un tiempo agotado). */
export const REINTENTOS_MODELO = 1;

/** Variante que usa el análisis si no se pide otra. Se fija con las mediciones de desarrollo (ia-poc/README.md). */
export const VARIANTE_POR_DEFECTO: VarianteIa = VarianteIa.V2;

/** Formato de salida que pide cada variante. Solo V2C es compacta. */
export const FORMATO_SALIDA_POR_VARIANTE: Readonly<
  Record<VarianteIa, FormatoSalidaIa>
> = {
  [VarianteIa.V1]: FormatoSalidaIa.COMPLETA,
  [VarianteIa.V2]: FormatoSalidaIa.COMPLETA,
  [VarianteIa.V3]: FormatoSalidaIa.COMPLETA,
  [VarianteIa.V2C]: FormatoSalidaIa.COMPACTA,
};

/**
 * Tope de tokens que el modelo puede escribir con la salida compacta (`num_predict` de Ollama). El JSON compacto mide ~38 tokens: 80 deja
 * margen y corta una salida que se desboca; un JSON cortado no valida y sigue el camino de reintento y degradado de siempre.
 */
export const NUM_PREDICT_SALIDA_COMPACTA = 80;

/** Límites de la salida del modelo: una salida corta es lo que más baja la latencia (unos 15 tokens por segundo). */
export const EXPLICACION_MAXIMA_CARACTERES = 400;
export const ALTERNATIVAS_MAXIMAS = 3;
export const SENALES_MAXIMAS = 4;
export const FRASE_MAXIMA_CARACTERES = 160;
export const CARGO_MAXIMO_CARACTERES = 80;
export const INFORMACION_FALTANTE_MAXIMA = 4;

/** Si la probabilidad de queja y de reclamo difiere menos que esto, se considera empate y se propone Reclamo con revisión humana. */
export const MARGEN_EMPATE_QUEJA_RECLAMO = 0.15;

/**
 * Si el modelo marca `posible_corrupcion` pero su peso es menor, el peso efectivo sube a este piso (`null`: sin piso). Calibrado en
 * `desarrollo-v2` (100 mensajes): sin piso el recall de las reglas + modelo era 75 %; con 5 y con 6 subió a 93 % y 97 %, con los mismos
 * 3 falsos positivos. El modelo marca la sospecha con pesos conservadores (3 a 6) aunque acierta la categoría; con 6 la marca, sumada
 * a cualquier puntaje de las reglas, supera `UMBRAL_TOTAL_CORRUPCION` (5). El peso sigue siendo el del modelo para todo lo demás.
 */
export const PISO_PESO_POSIBLE_CORRUPCION_POR_DEFECTO: number | null = 6;

/** El análisis solo corre en el endpoint de pruebas si `IA_POC_HABILITADA=true`. */
export const RUTA_ANALISIS_IA = "/ia-poc/analizar";
export const ESTABLECIMIENTO_MAXIMO_CARACTERES = 200;
