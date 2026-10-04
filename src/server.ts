import { createApp } from "@/app.js";
import { loadEnv } from "@/config/env.js";
import { createLogger } from "@/config/logger.js";
import { SHUTDOWN_TIMEOUT_MS } from "@/constants/limits.js";
import { createPgDatabase } from "@/database/pg-database.js";

const env = loadEnv();
const logger = createLogger(env);
const database = createPgDatabase(env, logger);
const app = createApp(env, database, logger);

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "minsa-incidencias-backend escuchando");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "cerrando el servidor");
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  server.close(() => {
    database
      .close()
      .catch((error: unknown) => logger.error({ err: error }, "error al cerrar la base de datos"))
      .finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
