export const CategoriaIncidencia = {
  DENUNCIA_CORRUPCION: "DENUNCIA_CORRUPCION",
  QUEJA: "QUEJA",
  RECLAMO: "RECLAMO",
  OTRO: "OTRO",
} as const;
export type CategoriaIncidencia = (typeof CategoriaIncidencia)[keyof typeof CategoriaIncidencia];
