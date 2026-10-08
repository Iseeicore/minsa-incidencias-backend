export const VistaCodigo = {
  INICIO: "INICIO",
  CASOS: "CASOS",
  BANDEJAS: "BANDEJAS",
  DERIVACIONES: "DERIVACIONES",
  QR: "QR",
} as const;
export type VistaCodigo = (typeof VistaCodigo)[keyof typeof VistaCodigo];
