export const EstadoIncidencia = {
  REGISTRADO: "REGISTRADO",
  CLASIFICADO: "CLASIFICADO",
  DERIVADO: "DERIVADO",
  EN_GESTION: "EN_GESTION",
  RESUELTO: "RESUELTO",
  ARCHIVADO: "ARCHIVADO",
} as const;
export type EstadoIncidencia = (typeof EstadoIncidencia)[keyof typeof EstadoIncidencia];
