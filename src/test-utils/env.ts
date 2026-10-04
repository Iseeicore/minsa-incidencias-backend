import { loadEnv, type Env } from "@/config/env.js";

export const TEST_COOKIE_SECRET = "secreto-de-prueba-de-al-menos-32-caracteres";
export const TEST_DATABASE_URL = "postgresql://usuario:clave@localhost:5432/prueba";

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    COOKIE_SECRET: TEST_COOKIE_SECRET,
    DATABASE_URL: TEST_DATABASE_URL,
    CORS_ORIGINS: "http://localhost:4010",
    ...overrides,
  });
}
