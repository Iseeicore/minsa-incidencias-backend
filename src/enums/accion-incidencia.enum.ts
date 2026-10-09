export const AccionIncidencia = {
  CONFIRMAR: "confirmar",
  CORREGIR: "corregir",
  DERIVAR: "derivar",
  TOMAR: "tomar",
  RESOLVER: "resolver",
  ARCHIVAR: "archivar",
  REABRIR: "reabrir",
} as const;
export type AccionIncidencia = (typeof AccionIncidencia)[keyof typeof AccionIncidencia];
