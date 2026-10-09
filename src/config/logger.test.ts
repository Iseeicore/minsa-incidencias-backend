import { describe, expect, it } from "vitest";
import { createLogger } from "@/config/logger.js";
import { testEnv } from "@/test-utils/env.js";

const CLAVE = "Zk7mNpQrStUvWxYz2345";
const HUELLA = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA";

function registrar(accion: (logger: ReturnType<typeof createLogger>) => void): string {
  const lineas: string[] = [];
  const logger = createLogger(testEnv({ LOG_LEVEL: "info" }), { write: (linea: string) => void lineas.push(linea) });
  accion(logger);
  return lineas.join("");
}

describe("logger", () => {
  it("oculta las cookies y la autorización de la petición", () => {
    const salida = registrar((logger) =>
      logger.info({ req: { headers: { cookie: "gestion_sid=secreto", authorization: "Bearer secreto" } } }, "petición"),
    );
    expect(salida).not.toContain("secreto");
    expect(salida).toContain("[oculto]");
  });

  it("oculta la clave inicial y la huella en cualquier objeto registrado", () => {
    const salida = registrar((logger) => {
      logger.info({ claveInicial: CLAVE, password: CLAVE, passwordHash: HUELLA }, "directo");
      logger.info({ usuario: { claveInicial: CLAVE, password_hash: HUELLA, password: CLAVE } }, "anidado");
      logger.info({ req: { body: { password: CLAVE } }, res: { body: { claveInicial: CLAVE } } }, "cuerpos");
    });
    expect(salida).not.toContain(CLAVE);
    expect(salida).not.toContain("argon2id");
    expect(salida).toContain("[oculto]");
  });

  it("oculta el detalle de un error de la base, que puede copiar la fila rechazada con su huella", () => {
    const error = Object.assign(new Error("falla"), {
      code: "23514",
      detail: `Failing row contains (uuid, Ana, ana@minsa.gob.pe, ${HUELLA}).`,
      where: `PL/pgSQL ${HUELLA}`,
    });
    const salida = registrar((logger) => logger.error({ err: error }, "error no controlado"));
    expect(salida).not.toContain("argon2id");
    expect(salida).not.toContain("Failing row");
    expect(salida).toContain("falla");
  });
});
