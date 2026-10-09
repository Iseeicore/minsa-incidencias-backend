export interface PosicionDeAreas {
  nombre: string;
  id: number;
}

const SEPARADOR = "|";
const NOMBRE_LONGITUD_MAXIMA = 300;

/** Cursor opaco del listado de áreas: el id y el nombre de la última área entregada, en base64url. */
export function codificarCursorDeAreas({ nombre, id }: PosicionDeAreas): string {
  return Buffer.from(`${id}${SEPARADOR}${nombre}`, "utf8").toString("base64url");
}

/** Devuelve `null` si el texto no es un cursor que esta API haya emitido. El nombre puede llevar el separador: se corta en el primero. */
export function decodificarCursorDeAreas(cursor: string): PosicionDeAreas | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const texto = Buffer.from(cursor, "base64url").toString("utf8");
  const corte = texto.indexOf(SEPARADOR);
  if (corte < 0) return null;
  const idTexto = texto.slice(0, corte);
  const nombre = texto.slice(corte + 1);
  if (!/^[1-9]\d{0,9}$/.test(idTexto)) return null;
  const id = Number(idTexto);
  if (id > 2_147_483_647 || nombre.length === 0 || nombre.length > NOMBRE_LONGITUD_MAXIMA || nombre.includes("\u0000")) return null;
  return { nombre, id };
}
