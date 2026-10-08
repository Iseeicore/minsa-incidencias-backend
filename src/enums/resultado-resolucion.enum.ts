/** Códigos de `catalogo.resultado_resolucion`. */
export const ResultadoResolucion = {
  ATENDIDO: "ATENDIDO",
  CERRADO: "CERRADO",
} as const;
export type ResultadoResolucion = (typeof ResultadoResolucion)[keyof typeof ResultadoResolucion];
