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

/** Clase de entidad del catálogo (se deduce del nombre oficial en `ia-poc/scripts/generar-catalogo.mjs`). */
export const TipoEntidad = {
  MINISTERIO: "MINISTERIO",
  SIS: "SIS",
  FONDO: "FONDO",
  INSTITUTO: "INSTITUTO",
  HOSPITAL: "HOSPITAL",
  DIRIS: "DIRIS",
  ORGANISMO: "ORGANISMO",
  CENTRO: "CENTRO",
  PROGRAMA: "PROGRAMA",
} as const;
export type TipoEntidad = (typeof TipoEntidad)[keyof typeof TipoEntidad];

/** Contactos de derivación que la nota del catálogo registra por entidad (sección 2). */
export const TipoContacto = {
  OCI: "OCI",
  SECRETARIA_TECNICA_PAD: "SECRETARIA_TECNICA_PAD",
  INTEGRIDAD: "INTEGRIDAD",
  PROCURADOR: "PROCURADOR",
} as const;
export type TipoContacto = (typeof TipoContacto)[keyof typeof TipoContacto];

/** Lo que la nota del catálogo marca como faltante o por confirmar de una entidad. */
export const HuecoCatalogo = {
  SIN_NOMBRE_TITULAR: "SIN_NOMBRE_TITULAR",
  TITULAR_POR_CONFIRMAR: "TITULAR_POR_CONFIRMAR",
  SIN_OCI: "SIN_OCI",
  SIN_SECRETARIA_TECNICA_PAD: "SIN_SECRETARIA_TECNICA_PAD",
  SIN_INTEGRIDAD: "SIN_INTEGRIDAD",
  SIN_PROCURADOR: "SIN_PROCURADOR",
  SIN_CONTACTOS: "SIN_CONTACTOS",
  DIRECTORIO_INCOMPLETO: "DIRECTORIO_INCOMPLETO",
} as const;
export type HuecoCatalogo = (typeof HuecoCatalogo)[keyof typeof HuecoCatalogo];

/** Señal que no es corrupción pero merece trato aparte (separada del puntaje de corrupción). */
export const SenalSensible = {
  ACOSO: "ACOSO",
} as const;
export type SenalSensible = (typeof SenalSensible)[keyof typeof SenalSensible];

/** Cómo se ponen de acuerdo las reglas y el modelo (plan de PoC, sección 6): de ahí sale la banda de confianza. */
export const AcuerdoReglasIa = {
  /** Reglas y modelo ven lo mismo (los dos corrupción, o los dos no). */
  COINCIDEN: "COINCIDEN",
  /** Solo uno de los dos ve corrupción y el otro no dice lo contrario, o hizo falta sumar los dos para llegar al umbral. */
  SOLO_UNO: "SOLO_UNO",
  /** Uno ve corrupción y el otro la descarta: se marca revisión. */
  DISCREPAN: "DISCREPAN",
  /** El modelo no estuvo disponible: solo hay reglas. */
  SIN_MODELO: "SIN_MODELO",
} as const;
export type AcuerdoReglasIa = (typeof AcuerdoReglasIa)[keyof typeof AcuerdoReglasIa];
