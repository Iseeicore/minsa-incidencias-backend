export const VistaCodigo = {
  INICIO: "INICIO",
  CASOS: "CASOS",
  BANDEJAS: "BANDEJAS",
  DERIVACIONES: "DERIVACIONES",
} as const;
export type VistaCodigo = (typeof VistaCodigo)[keyof typeof VistaCodigo];
