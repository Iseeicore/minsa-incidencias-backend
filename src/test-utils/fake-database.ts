import { vi } from "vitest";
import type { Database } from "@/database/database.js";

export function createFakeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    query: vi.fn(async () => []),
    transaction: vi.fn(async (_actor, work) => work({ query: vi.fn(async () => []) })),
    ping: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}
