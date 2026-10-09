export const TipoArea = {
  ESTABLECIMIENTO: "ESTABLECIMIENTO",
  OTRANS: "OTRANS",
  DIRIS: "DIRIS",
  INSTITUTO: "INSTITUTO",
  ORGANISMO: "ORGANISMO",
} as const;
export type TipoArea = (typeof TipoArea)[keyof typeof TipoArea];
