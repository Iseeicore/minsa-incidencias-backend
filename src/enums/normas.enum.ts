/** De qué documento sale un fragmento de norma (`ia-poc/datos/fragmentos-normas.json`). */
export const FuenteNorma = {
  DIRECTIVA_002_2023_PCM_SIP: "DIRECTIVA_002_2023_PCM_SIP",
  AYUDA_MEMORIA_OTRANS: "AYUDA_MEMORIA_OTRANS",
} as const;
export type FuenteNorma = (typeof FuenteNorma)[keyof typeof FuenteNorma];

/** Qué es el fragmento: un supuesto del Anexo C (falta, inconducta o delito) o un texto del procedimiento de OTRANS. */
export const TipoFragmentoNorma = {
  FALTA: "FALTA",
  INCONDUCTA: "INCONDUCTA",
  DELITO: "DELITO",
  DEFINICION: "DEFINICION",
  PROCEDIMIENTO: "PROCEDIMIENTO",
} as const;
export type TipoFragmentoNorma =
  (typeof TipoFragmentoNorma)[keyof typeof TipoFragmentoNorma];

/** Tema de las señales de las reglas que se relaciona con uno o más supuestos del Anexo C (`mapa-senal-fragmento.ts`). */
export const TemaNorma = {
  SOBORNO_O_COBRO: "SOBORNO_O_COBRO",
  EXIGENCIA: "EXIGENCIA",
  APROPIACION: "APROPIACION",
  APROPIACION_DE_DINERO: "APROPIACION_DE_DINERO",
  USO_PERSONAL_DE_BIENES: "USO_PERSONAL_DE_BIENES",
  NEPOTISMO: "NEPOTISMO",
  CONFLICTO_DE_INTERESES: "CONFLICTO_DE_INTERESES",
  FAVORECIMIENTO: "FAVORECIMIENTO",
  CONTRATACIONES: "CONTRATACIONES",
  PENALIDADES: "PENALIDADES",
  INFORMACION_PRIVILEGIADA: "INFORMACION_PRIVILEGIADA",
  ENRIQUECIMIENTO: "ENRIQUECIMIENTO",
  TRAFICO_DE_INFLUENCIAS: "TRAFICO_DE_INFLUENCIAS",
  VENTAJA_INDEBIDA: "VENTAJA_INDEBIDA",
} as const;
export type TemaNorma = (typeof TemaNorma)[keyof typeof TemaNorma];

/** Qué grupo de fragmentos se cita: los supuestos del Anexo C que coinciden con las señales, o el procedimiento de OTRANS. */
export const GrupoCita = {
  SUPUESTO: "SUPUESTO",
  PROCEDIMIENTO: "PROCEDIMIENTO",
} as const;
export type GrupoCita = (typeof GrupoCita)[keyof typeof GrupoCita];
