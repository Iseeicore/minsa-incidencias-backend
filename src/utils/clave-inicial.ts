import { randomInt } from "node:crypto";
import { CLAVE_INICIAL_ALFABETO, CLAVE_INICIAL_LONGITUD } from "@/constants/usuarios.js";

/**
 * Clave inicial de un usuario nuevo o restablecido: aleatoria criptográfica (`crypto.randomInt` elige sin sesgo cada
 * carácter de un alfabeto sin los que se confunden). Se entrega una sola vez a quien la pide y en la base solo queda su
 * huella Argon2id: nunca se registra, se audita ni va en un mensaje de error.
 */
export function generarClaveInicial(longitud: number = CLAVE_INICIAL_LONGITUD, alfabeto: string = CLAVE_INICIAL_ALFABETO): string {
  let clave = "";
  for (let i = 0; i < longitud; i += 1) clave += alfabeto[randomInt(alfabeto.length)];
  return clave;
}
