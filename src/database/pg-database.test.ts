import { describe, expect, it, vi } from "vitest";
import { PgDatabase, type PoolClientLike, type PoolLike } from "@/database/pg-database.js";

function buildPool(clientQuery: PoolClientLike["query"]) {
  const release = vi.fn();
  const client: PoolClientLike = { query: clientQuery, release };
  const pool: PoolLike = {
    query: vi.fn(async () => ({ rows: [{ uno: 1 }] })),
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  };
  return { pool, release };
}

function statementsOf(query: ReturnType<typeof vi.fn>): string[] {
  return query.mock.calls.map((call) => String(call[0]));
}

describe("PgDatabase", () => {
  it("query devuelve las filas del pool", async () => {
    const { pool } = buildPool(vi.fn());
    expect(await new PgDatabase(pool).query("SELECT 1 AS uno")).toEqual([{ uno: 1 }]);
  });

  it("ping ejecuta SELECT 1", async () => {
    const { pool } = buildPool(vi.fn());
    await new PgDatabase(pool).ping();
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("transaction abre BEGIN, declara el actor de forma local, confirma y libera", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const { pool, release } = buildPool(query);

    const result = await new PgDatabase(pool).transaction("usuario:ana@minsa.gob.pe", async (tx) => tx.query("SELECT 1"));

    expect(result).toEqual([{ id: 1 }]);
    expect(statementsOf(query)).toEqual([
      "BEGIN",
      "SELECT set_config('app.actor', $1, true)",
      "SELECT 1",
      "COMMIT",
    ]);
    expect(query).toHaveBeenCalledWith("SELECT set_config('app.actor', $1, true)", ["usuario:ana@minsa.gob.pe"]);
    expect(release).toHaveBeenCalledWith(false);
  });

  it("si el trabajo falla hace ROLLBACK, no hace COMMIT y propaga el error", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const { pool, release } = buildPool(query);

    await expect(
      new PgDatabase(pool).transaction("a", async () => {
        throw new Error("fallo del negocio");
      }),
    ).rejects.toThrow("fallo del negocio");

    expect(statementsOf(query)).toContain("ROLLBACK");
    expect(statementsOf(query)).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledWith(false);
  });

  it("si el ROLLBACK también falla destruye la conexión y conserva el error original", async () => {
    const query = vi.fn(async (text: string) => {
      if (text === "ROLLBACK") throw new Error("conexión perdida");
      return { rows: [] };
    });
    const { pool, release } = buildPool(query);

    await expect(
      new PgDatabase(pool).transaction("a", async () => {
        throw new Error("fallo del negocio");
      }),
    ).rejects.toThrow("fallo del negocio");

    expect(release).toHaveBeenCalledWith(true);
  });

  it("close cierra el pool", async () => {
    const { pool } = buildPool(vi.fn());
    await new PgDatabase(pool).close();
    expect(pool.end).toHaveBeenCalled();
  });
});
