import { pino, type DestinationStream, type Logger } from "pino";
import type { Env } from "@/config/env.js";

/**
 * Nunca se registran cookies, claves ni huellas: el cuerpo de las peticiones no se registra, y aun así se ocultan los
 * campos de clave por si algún día se registra un objeto que los trae. El detalle de un error de la base puede copiar la
 * fila rechazada (con su huella), por eso `err.detail` y `err.where` también se ocultan.
 */
export const RUTAS_OCULTAS_EN_LOGS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "res.headers['set-cookie']",
  "req.body",
  "res.body",
  "password",
  "claveInicial",
  "passwordHash",
  "password_hash",
  "*.password",
  "*.claveInicial",
  "*.passwordHash",
  "*.password_hash",
  "err.detail",
  "err.where",
  "err.internalQuery",
];

/** `destino` solo lo usan las pruebas, para leer lo que se registra. */
export function createLogger(env: Env, destino?: DestinationStream): Logger {
  const opciones = { level: env.LOG_LEVEL, redact: { paths: RUTAS_OCULTAS_EN_LOGS, censor: "[oculto]" } };
  return destino ? pino(opciones, destino) : pino(opciones);
}
