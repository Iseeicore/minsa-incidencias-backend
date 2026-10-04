import { pino, type Logger } from "pino";
import type { Env } from "@/config/env.js";

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: ["req.headers.cookie", "req.headers.authorization", "res.headers['set-cookie']"],
      censor: "[oculto]",
    },
  });
}
