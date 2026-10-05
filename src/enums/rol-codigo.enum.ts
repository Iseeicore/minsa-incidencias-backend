export const RolCodigo = {
  ADMINISTRADOR: "ADMINISTRADOR",
  GESTOR: "GESTOR",
  REVISOR: "REVISOR",
  AREA_DENUNCIA_CORRUPCION: "AREA_DENUNCIA_CORRUPCION",
  AREA_QUEJA: "AREA_QUEJA",
  AREA_RECLAMO: "AREA_RECLAMO",
} as const;
export type RolCodigo = (typeof RolCodigo)[keyof typeof RolCodigo];
