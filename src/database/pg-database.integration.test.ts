import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@/config/logger.js";
import { ACTOR_SISTEMA_GESTION } from "@/database/actor.js";
import { createPgDatabase, type PgDatabase } from "@/database/pg-database.js";
import { testEnv } from "@/test-utils/env.js";

const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("PgDatabase contra PostgreSQL real", () => {
  let database: PgDatabase;

  beforeAll(() => {
    const env = testEnv({ DATABASE_URL: url as string });
    database = createPgDatabase(env, createLogger(env));
  });

  afterAll(async () => {
    await database.close();
  });

  it("responde el ping", async () => {
    await expect(database.ping()).resolves.toBeUndefined();
  });

  it("lee las cargas iniciales que dejan las migraciones del bot", async () => {
    const estados = await database.query<{ codigo: string }>("SELECT codigo FROM catalogo.estado_incidencia ORDER BY id");
    expect(estados.map((fila) => fila.codigo)).toEqual(
      expect.arrayContaining(["REGISTRADO", "CLASIFICADO", "EN_GESTION", "RESUELTO", "DERIVADO", "ARCHIVADO"]),
    );

    const roles = await database.query<{ codigo: string }>("SELECT codigo FROM gestion.rol");
    expect(roles.map((fila) => fila.codigo)).toEqual(expect.arrayContaining(["ADMINISTRADOR", "GESTOR", "OTRANS", "ESTABLECIMIENTO"]));
  });

  it("declara el actor solo dentro de la transacción", async () => {
    const dentro = await database.transaction(ACTOR_SISTEMA_GESTION, async (tx) =>
      tx.query<{ actor: string }>("SELECT current_setting('app.actor', true) AS actor"),
    );
    expect(dentro[0]?.actor).toBe(ACTOR_SISTEMA_GESTION);

    const fuera = await database.query<{ actor: string | null }>("SELECT current_setting('app.actor', true) AS actor");
    expect(fuera[0]?.actor ?? "").toBe("");
  });

  it("tras un error revierte, no filtra el actor y el pool sigue sirviendo", async () => {
    await expect(
      database.transaction("usuario:prueba", async (tx) => {
        await tx.query("SELECT 1");
        throw new Error("fallo");
      }),
    ).rejects.toThrow("fallo");

    const fuera = await database.query<{ actor: string | null }>("SELECT current_setting('app.actor', true) AS actor");
    expect(fuera[0]?.actor ?? "").toBe("");
    await expect(database.ping()).resolves.toBeUndefined();
  });
});
