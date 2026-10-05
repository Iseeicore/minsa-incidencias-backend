export const OrdenIncidencia = {
  FECHA: "fecha",
  CODIGO: "codigo",
  CATEGORIA: "categoria",
  ESTADO: "estado",
  CONFIANZA: "confianza",
} as const;
export type OrdenIncidencia = (typeof OrdenIncidencia)[keyof typeof OrdenIncidencia];

export const DireccionOrden = {
  ASCENDENTE: "asc",
  DESCENDENTE: "desc",
} as const;
export type DireccionOrden = (typeof DireccionOrden)[keyof typeof DireccionOrden];
