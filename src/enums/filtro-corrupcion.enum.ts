/** Qué clase de elemento aportó puntos (o los restó) al puntaje del filtro de corrupción. */
export const TipoSenal = {
  FUERTE: "FUERTE",
  MEDIA: "MEDIA",
  DEBIL: "DEBIL",
  NEGATIVA_DECISIVA: "NEGATIVA_DECISIVA",
  NEGATIVA_LEVE: "NEGATIVA_LEVE",
  ACTOR: "ACTOR",
  ENTIDAD: "ENTIDAD",
} as const;
export type TipoSenal = (typeof TipoSenal)[keyof typeof TipoSenal];

export const CertezaCorrupcion = {
  ALTA: "ALTA",
  MEDIA: "MEDIA",
  BAJA: "BAJA",
} as const;
export type CertezaCorrupcion = (typeof CertezaCorrupcion)[keyof typeof CertezaCorrupcion];

/** Nivel del cargo detectado (sección 6 del léxico). */
export const NivelCargo = {
  CARGO_MAXIMO: "CARGO_MAXIMO",
  CARGO_DE_LINEA: "CARGO_DE_LINEA",
  PERSONAL: "PERSONAL",
} as const;
export type NivelCargo = (typeof NivelCargo)[keyof typeof NivelCargo];

/** Requisitos de la sección 3c del plan de cierre que el texto aún no cumple. */
export const FaltanteCorrupcion = {
  DATOS_INSUFICIENTES: "DATOS_INSUFICIENTES",
  AUTOR_O_CARGO: "AUTOR_O_CARGO",
  ENTIDAD: "ENTIDAD",
  PRUEBAS: "PRUEBAS",
} as const;
export type FaltanteCorrupcion = (typeof FaltanteCorrupcion)[keyof typeof FaltanteCorrupcion];
