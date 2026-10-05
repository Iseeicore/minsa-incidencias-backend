export const ModuloCodigo = {
  INCIDENCIAS: "INCIDENCIAS",
  REVISION: "REVISION",
  INDICADORES: "INDICADORES",
  ENTRENAMIENTO_IA: "ENTRENAMIENTO_IA",
  USUARIOS: "USUARIOS",
} as const;
export type ModuloCodigo = (typeof ModuloCodigo)[keyof typeof ModuloCodigo];
