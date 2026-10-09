import { describe, expect, it } from "vitest";
import { loadEnv } from "@/config/env.js";
import { TEST_COOKIE_SECRET, TEST_DATABASE_URL } from "@/test-utils/env.js";

const base = { COOKIE_SECRET: TEST_COOKIE_SECRET, DATABASE_URL: TEST_DATABASE_URL };

describe("loadEnv", () => {
  it("aplica los valores por defecto", () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(3033);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(300);
    expect(env.RATE_LIMIT_AUTH_CAPACITY).toBe(300);
    expect(env.RATE_LIMIT_ANON_CAPACITY).toBe(100);
    expect(env.RATE_LIMIT_LOGIN_CAPACITY).toBe(5);
    expect(env.RATE_LIMIT_LOGIN_WINDOW_SECONDS).toBe(900);
  });

  it("falla al arrancar si falta la URL de la base de datos", () => {
    expect(() => loadEnv({ COOKIE_SECRET: TEST_COOKIE_SECRET })).toThrow();
  });

  it.each(["localhost:5432/base", "mysql://usuario:clave@localhost/base", "http://localhost"])(
    "rechaza una URL de base de datos que no es de PostgreSQL: %s",
    (url) => {
      expect(() => loadEnv({ ...base, DATABASE_URL: url })).toThrow();
    },
  );

  it("acepta postgres:// y postgresql://", () => {
    expect(loadEnv({ ...base, DATABASE_URL: "postgres://u:p@h:5432/b" }).DATABASE_URL).toContain("postgres://");
    expect(loadEnv(base).DATABASE_URL).toContain("postgresql://");
  });

  it("falla al arrancar si falta el secreto de las cookies", () => {
    expect(() => loadEnv({})).toThrow();
  });

  it("falla si el secreto es demasiado corto", () => {
    expect(() => loadEnv({ COOKIE_SECRET: "corto" })).toThrow();
  });

  it("separa y limpia la lista de orígenes", () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: " http://localhost:4010 , https://gestion.minsa.gob.pe " });
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:4010", "https://gestion.minsa.gob.pe"]);
  });

  it.each(["*", "localhost:4010", "http://localhost:4010/", "http://localhost:4010/ruta", "ftp://servidor"])(
    "rechaza el origen inválido %s",
    (origin) => {
      expect(() => loadEnv({ ...base, CORS_ORIGINS: origin })).toThrow();
    },
  );

  it("los plazos por defecto son 3 días de atención, 3 de vigencia y 24 horas de aviso", () => {
    const env = loadEnv(base);
    expect(env.PLAZO_ATENCION_DIAS).toBe(3);
    expect(env.VIGENCIA_RESOLUCION_DIAS).toBe(3);
    expect(env.PLAZO_AVISO_HORAS).toBe(24);
  });

  it("los plazos se pueden cambiar por variable de entorno", () => {
    const env = loadEnv({ ...base, PLAZO_ATENCION_DIAS: "5", VIGENCIA_RESOLUCION_DIAS: "7", PLAZO_AVISO_HORAS: "48" });
    expect(env.PLAZO_ATENCION_DIAS).toBe(5);
    expect(env.VIGENCIA_RESOLUCION_DIAS).toBe(7);
    expect(env.PLAZO_AVISO_HORAS).toBe(48);
  });

  it.each(["0", "-1", "abc", "1.5"])("rechaza un plazo que no es un entero positivo: %s", (valor) => {
    expect(() => loadEnv({ ...base, PLAZO_ATENCION_DIAS: valor })).toThrow();
    expect(() => loadEnv({ ...base, VIGENCIA_RESOLUCION_DIAS: valor })).toThrow();
    expect(() => loadEnv({ ...base, PLAZO_AVISO_HORAS: valor })).toThrow();
  });

  it("IA_POC_HABILITADA está apagada por defecto, se enciende con true y rechaza otros valores", () => {
    expect(loadEnv(base).IA_POC_HABILITADA).toBe(false);
    expect(loadEnv({ ...base, IA_POC_HABILITADA: "true" }).IA_POC_HABILITADA).toBe(true);
    expect(() => loadEnv({ ...base, IA_POC_HABILITADA: "si" })).toThrow();
  });

  it("rechaza una capacidad que no es un entero positivo", () => {
    expect(() => loadEnv({ ...base, RATE_LIMIT_ANON_CAPACITY: "0" })).toThrow();
    expect(() => loadEnv({ ...base, RATE_LIMIT_AUTH_CAPACITY: "abc" })).toThrow();
  });
});
