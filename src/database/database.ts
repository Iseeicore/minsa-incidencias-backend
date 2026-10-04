import type { QueryResultRow } from "pg";

export interface DbExecutor {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
}

export interface Database extends DbExecutor {
  transaction<T>(actor: string, work: (executor: DbExecutor) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
