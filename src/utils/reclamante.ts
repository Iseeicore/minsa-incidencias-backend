import { DNI_ENMASCARADO, RECLAMANTE_ANONIMO, RECLAMANTE_SIN_DATOS } from "@/constants/incidencias.js";

export interface DatosDelReclamante {
  esAnonimo: boolean;
  nombre: string | null;
  dni: string | null;
}

const ULTIMOS_DIGITOS_VISIBLES = 4;

function abreviarNombre(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  const [primera, segunda] = palabras;
  if (!primera) return "";
  if (!segunda || segunda.length < 2) return segunda ? `${primera} ${segunda}` : primera;
  return `${primera} ${segunda.charAt(0).toUpperCase()}.`;
}

function enmascararDni(dni: string): string {
  const limpio = dni.trim();
  if (limpio.length <= ULTIMOS_DIGITOS_VISIBLES) return DNI_ENMASCARADO;
  return `${DNI_ENMASCARADO}${limpio.slice(-ULTIMOS_DIGITOS_VISIBLES)}`;
}

/**
 * Cómo se muestra a la persona que presentó el reporte: el nombre abreviado y solo los últimos 4 dígitos del
 * documento. Un reporte anónimo no muestra nada.
 */
export function describirReclamante({ esAnonimo, nombre, dni }: DatosDelReclamante): string {
  if (esAnonimo) return RECLAMANTE_ANONIMO;
  const nombreCorto = nombre ? abreviarNombre(nombre) : "";
  const documento = dni && dni.trim() ? `DNI ${enmascararDni(dni)}` : "";
  const partes = [nombreCorto, documento].filter(Boolean);
  return partes.length > 0 ? partes.join(" · ") : RECLAMANTE_SIN_DATOS;
}
