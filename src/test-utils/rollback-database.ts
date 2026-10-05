import pg, { type QueryResultRow } from "pg";
import type { Database, DbExecutor } from "@/database/database.js";

export interface RollbackContext {
  database: Database;
  client: pg.Client;
}

export async function withRollbackDatabase(
  url: string,
  work: (context: RollbackContext) => Promise<void>,
): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("BEGIN");

  const executor: DbExecutor = {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
      const result = await client.query<T>(text, values);
      return result.rows;
    },
  };

  const database: Database = {
    query: executor.query,
    async transaction(actor, fn) {
      await client.query("SAVEPOINT prueba");
      try {
        await client.query("SELECT set_config('app.actor', $1, true)", [actor]);
        const result = await fn(executor);
        await client.query("RELEASE SAVEPOINT prueba");
        return result;
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT prueba");
        throw error;
      }
    },
    async ping() {
      await client.query("SELECT 1");
    },
    async close() {
      return undefined;
    },
  };

  try {
    await work({ database, client });
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}
