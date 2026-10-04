import { Pool, type QueryResultRow } from "pg";
import type { Logger } from "pino";
import type { Env } from "@/config/env.js";
import {
  DB_CONNECTION_TIMEOUT_MS,
  DB_IDLE_TIMEOUT_MS,
  DB_POOL_MAX,
  DB_STATEMENT_TIMEOUT_MS,
} from "@/constants/limits.js";
import type { Database, DbExecutor } from "./database.js";

export interface QueryableClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PoolClientLike extends QueryableClient {
  release(destroy?: boolean): void;
}

export interface PoolLike extends QueryableClient {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

function asExecutor(client: QueryableClient): DbExecutor {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
      const result = await client.query(text, values);
      return result.rows as T[];
    },
  };
}

export class PgDatabase implements Database {
  constructor(private readonly pool: PoolLike) {}

  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T[]> {
    return asExecutor(this.pool).query<T>(text, values);
  }

  async transaction<T>(actor: string, work: (executor: DbExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroy = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.actor', $1, true)", [actor]);
      const result = await work(asExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        destroy = true;
      });
      throw error;
    } finally {
      client.release(destroy);
    }
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

export function createPgDatabase(env: Env, logger: Logger): PgDatabase {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: DB_POOL_MAX,
    idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  });
  pool.on("error", (error) => {
    logger.error({ err: error }, "error en una conexión inactiva de la base de datos");
  });
  return new PgDatabase(pool as unknown as PoolLike);
}
