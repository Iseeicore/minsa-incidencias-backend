export const VistaCodigo = {
  INICIO: "INICIO",
  CASOS: "CASOS",
  BANDEJAS: "BANDEJAS",
  DERIVACIONES: "DERIVACIONES",
  QR: "QR",
  USUARIOS: "USUARIOS",
} as const;
export type VistaCodigo = (typeof VistaCodigo)[keyof typeof VistaCodigo];
