/** Por qué el clasificador escribió la categoría que escribió (va en `incidencia_analisis.senales.decision.motivo`). */
export const MotivoDeEscritura = {
  /** Las reglas del léxico proponen corrupción. */
  REGLAS: "REGLAS",
  /** Las reglas proponen corrupción por la identidad (entidad o titular con un indicio), certeza baja. */
  IDENTIDAD: "IDENTIDAD",
  /** Las reglas no la proponían: el peso del modelo llevó el total sobre el umbral. */
  SUMA_CON_MODELO: "SUMA_CON_MODELO",
  /** Duda: el modelo sospecha corrupción pero la suma no alcanza. Ante la duda, OTRANS. */
  DUDA_DEL_MODELO: "DUDA_DEL_MODELO",
  /** Duda: las reglas piden segunda opinión (zona gris) y el modelo no estuvo disponible. Ante la duda, OTRANS. */
  DUDA_SIN_MODELO: "DUDA_SIN_MODELO",
  /** No hay corrupción ni duda: se escribe la categoría que propone el análisis. */
  SIN_CORRUPCION: "SIN_CORRUPCION",
} as const;
export type MotivoDeEscritura =
  (typeof MotivoDeEscritura)[keyof typeof MotivoDeEscritura];
