import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const INTEGRACION = "src/**/*.integration.test.ts";

/**
 * Las pruebas de integración usan la misma base y varias insertan casos (`sembrarCaso`), unas con `ALTER TABLE ... DISABLE TRIGGER USER`
 * para darles edad. Si dos archivos corren a la vez, esa orden y los inserts que esperan el contador de códigos se bloquean entre sí
 * (`deadlock detected`). Por eso los archivos de integración corren de a uno; las pruebas unitarias siguen en paralelo, a la vez.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unitarias",
          include: ["src/**/*.test.ts"],
          exclude: [INTEGRACION, "node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integracion",
          include: [INTEGRACION],
          fileParallelism: false,
        },
      },
    ],
  },
});
