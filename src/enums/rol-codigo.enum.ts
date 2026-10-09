export const RolCodigo = {
  ADMINISTRADOR: "ADMINISTRADOR",
  GESTOR: "GESTOR",
  OTRANS: "OTRANS",
  ESTABLECIMIENTO: "ESTABLECIMIENTO",
  DIRIS: "DIRIS",
} as const;
export type RolCodigo = (typeof RolCodigo)[keyof typeof RolCodigo];
