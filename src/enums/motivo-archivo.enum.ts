/** Códigos de `catalogo.motivo_archivo`. Los dos primeros los elige una persona al archivar; los otros dos los pone el sistema. */
export const MotivoArchivo = {
  DATOS_INSUFICIENTES: "DATOS_INSUFICIENTES",
  NO_CORRESPONDE: "NO_CORRESPONDE",
  VENCIDA_SIN_ATENDER: "VENCIDA_SIN_ATENDER",
  RESUELTA_VIGENCIA: "RESUELTA_VIGENCIA",
} as const;
export type MotivoArchivo = (typeof MotivoArchivo)[keyof typeof MotivoArchivo];
