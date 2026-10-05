import { z } from "zod";
import { MIN_SECRET_LENGTH } from "@/constants/limits.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ALLOWED_PROTOCOLS.has(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}

const originSchema = z.string().refine(isOrigin, {
  message: "debe ser un origen válido (esquema, dominio y puerto, sin ruta ni comodín)",
});

const positiveInt = z.coerce.number().int().min(1);

const databaseUrlSchema = z.string().refine((value) => /^postgres(ql)?:\/\/.+/.test(value), {
  message: "debe ser una URL de PostgreSQL (postgresql://usuario:clave@host:puerto/base)",
});

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3033),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(originSchema)),
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  COOKIE_SECRET: z.string().min(MIN_SECRET_LENGTH),
  DATABASE_URL: databaseUrlSchema,
  RATE_LIMIT_WINDOW_SECONDS: positiveInt.default(300),
  RATE_LIMIT_AUTH_CAPACITY: positiveInt.default(300),
  RATE_LIMIT_ANON_CAPACITY: positiveInt.default(100),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: positiveInt.default(900),
  RATE_LIMIT_LOGIN_CAPACITY: positiveInt.default(5),
  SESSION_IDLE_MINUTES: positiveInt.default(30),
  SESSION_ABSOLUTE_HOURS: positiveInt.default(8),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(source);
}
