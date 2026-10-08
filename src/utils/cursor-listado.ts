export interface PosicionDeListado {
  fechaCreacion: Date;
  id: string;
}

const UUID_PATRON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEPARADOR = "|";

/** Cursor opaco del listado: la fecha de creación y el id del último caso entregado, en base64url. */
export function codificarCursor({ fechaCreacion, id }: PosicionDeListado): string {
  return Buffer.from(`${fechaCreacion.toISOString()}${SEPARADOR}${id}`, "utf8").toString("base64url");
}

/** Devuelve `null` si el texto no es un cursor que esta API haya emitido: nunca llega a la consulta. */
export function decodificarCursor(cursor: string): PosicionDeListado | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const partes = Buffer.from(cursor, "base64url").toString("utf8").split(SEPARADOR);
  if (partes.length !== 2) return null;
  const [fecha, id] = partes as [string, string];
  const fechaCreacion = new Date(fecha);
  if (Number.isNaN(fechaCreacion.getTime()) || fechaCreacion.toISOString() !== fecha || !UUID_PATRON.test(id)) return null;
  return { fechaCreacion, id };
}
