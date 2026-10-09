/** Variante del prompt del modelo (plan de PoC, sección 10). V4 (RAG con fragmentos de normas) sigue sin implementar: ver `prompts.ts`. */
export const VarianteIa = {
  /** Sistema completo: rol, definiciones, reglas duras y peso 0 a 10 con anclas. */
  V1: "V1",
  /** V1 más las señales de las reglas y la entidad o el titular detectados, como pistas. */
  V2: "V2",
  /** V2 más ejemplos resueltos (casos límite del léxico y ejemplos inventados). */
  V3: "V3",
} as const;
export type VarianteIa = (typeof VarianteIa)[keyof typeof VarianteIa];

/** Lista fija de lo que el modelo puede decir que falta para poder derivar (plan de cierre, sección 3c). */
export const InformacionFaltanteIa = {
  HECHO_DETALLADO: "hecho_detallado",
  AUTOR_O_CARGO: "autor_o_cargo",
  ENTIDAD_O_UNIDAD: "entidad_o_unidad",
  PRUEBAS: "pruebas",
} as const;
export type InformacionFaltanteIa =
  (typeof InformacionFaltanteIa)[keyof typeof InformacionFaltanteIa];

/** Clase de la frase que el modelo señala en el texto. */
export const TipoSenalModelo = {
  COBRO_INDEBIDO: "COBRO_INDEBIDO",
  FAVORECIMIENTO: "FAVORECIMIENTO",
  APROPIACION: "APROPIACION",
  ACTOR_PUBLICO: "ACTOR_PUBLICO",
  ENTIDAD: "ENTIDAD",
  /** Frase que descarta la corrupción (pago con boleta, tarifa oficial, rumor). */
  DESCARTE: "DESCARTE",
  OTRA: "OTRA",
} as const;
export type TipoSenalModelo =
  (typeof TipoSenalModelo)[keyof typeof TipoSenalModelo];

/** Por qué el modelo no aportó un resultado: el orquestador degrada a solo reglas. */
export const MotivoFalloIa = {
  SIN_CONEXION: "SIN_CONEXION",
  TIEMPO_AGOTADO: "TIEMPO_AGOTADO",
  ERROR_HTTP: "ERROR_HTTP",
  RESPUESTA_VACIA: "RESPUESTA_VACIA",
  JSON_INVALIDO: "JSON_INVALIDO",
  ESQUEMA_INVALIDO: "ESQUEMA_INVALIDO",
  /** Se lanzó una excepción inesperada dentro del cliente. */
  ERROR_INESPERADO: "ERROR_INESPERADO",
} as const;
export type MotivoFalloIa = (typeof MotivoFalloIa)[keyof typeof MotivoFalloIa];

/** De dónde sale un fundamento de la propuesta. */
export const OrigenFundamento = {
  REGLAS: "REGLAS",
  MODELO: "MODELO",
} as const;
export type OrigenFundamento =
  (typeof OrigenFundamento)[keyof typeof OrigenFundamento];
