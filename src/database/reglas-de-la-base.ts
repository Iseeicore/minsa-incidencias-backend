import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";

const CHECK_VIOLATION = "23514";
const MENSAJE_REGLA_DESCONOCIDA = "El cambio no cumple una regla del caso.";

const REGLAS_CONOCIDAS: readonly { fragmento: string; mensaje: string }[] = [
  { fragmento: "la categoria ya se corrigio una vez", mensaje: "La categoría ya se corrigió una vez." },
  { fragmento: "ya se confirmo y no se puede corregir", mensaje: "La categoría ya se confirmó y no se puede corregir." },
  { fragmento: "la confirmacion se registra una sola vez", mensaje: "La categoría ya se confirmó." },
  { fragmento: "una categoria corregida no se puede confirmar", mensaje: "La categoría ya se corrigió y no se puede confirmar." },
  { fragmento: "no hay categoria de la IA que confirmar", mensaje: "El caso todavía no tiene una categoría de la IA que confirmar." },
  { fragmento: "la resolucion solo se registra una vez", mensaje: "El caso ya tiene una resolución." },
  { fragmento: "transicion de estado no permitida", mensaje: "El caso no puede pasar a ese estado desde el que tiene ahora." },
];

/**
 * Las reglas del caso viven en la base y la protegen aunque dos personas actúen a la vez. Cuando un disparador
 * rechaza el cambio, devuelve un 409 con un mensaje claro en español y sin repetir el texto técnico. Cualquier
 * otro error se devuelve igual.
 */
export function traducirErrorDeBase(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== CHECK_VIOLATION) return error;
  const regla = REGLAS_CONOCIDAS.find(({ fragmento }) => error.message.includes(fragmento));
  return new AppError(HttpStatus.CONFLICT, ErrorCode.CONFLICT, regla?.mensaje ?? MENSAJE_REGLA_DESCONOCIDA);
}
