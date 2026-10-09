import { USUARIO_ID_PATRON } from "@/constants/usuarios.js";

export interface PosicionDeUsuarios {
  nombre: string;
  id: string;
}

const SEPARADOR = "|";
const NOMBRE_LONGITUD_MAXIMA = 300;

/** Cursor opaco del listado de usuarios: el id y el nombre del último usuario entregado, en base64url. */
export function codificarCursorDeUsuarios({ nombre, id }: PosicionDeUsuarios): string {
  return Buffer.from(`${id}${SEPARADOR}${nombre}`, "utf8").toString("base64url");
}

/** Devuelve `null` si el texto no es un cursor que esta API haya emitido. El nombre puede llevar el separador: se corta en el primero. */
export function decodificarCursorDeUsuarios(cursor: string): PosicionDeUsuarios | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const texto = Buffer.from(cursor, "base64url").toString("utf8");
  const corte = texto.indexOf(SEPARADOR);
  if (corte < 0) return null;
  const id = texto.slice(0, corte);
  const nombre = texto.slice(corte + 1);
  if (!USUARIO_ID_PATRON.test(id) || nombre.length === 0 || nombre.length > NOMBRE_LONGITUD_MAXIMA || nombre.includes("\u0000")) return null;
  return { nombre, id };
}
