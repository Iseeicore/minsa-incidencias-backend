import { z } from "zod";
import { loadEnv } from "@/config/env.js";
import { createLogger } from "@/config/logger.js";
import { MIN_ADMIN_PASSWORD_LENGTH } from "@/constants/limits.js";
import { createPgDatabase } from "@/database/pg-database.js";
import { crearAdministrador } from "@/services/administrador.service.js";
import { ArgonPasswordHasher } from "@/utils/password-hasher.js";

const datosSchema = z.object({
  ADMIN_NOMBRE: z.string().trim().min(1),
  ADMIN_CORREO: z.email(),
  ADMIN_PASSWORD: z.string().min(MIN_ADMIN_PASSWORD_LENGTH),
});

const env = loadEnv();
const database = createPgDatabase(env, createLogger(env));

try {
  const datos = datosSchema.parse(process.env);
  await crearAdministrador(database, new ArgonPasswordHasher(), {
    nombreCompleto: datos.ADMIN_NOMBRE,
    correo: datos.ADMIN_CORREO,
    password: datos.ADMIN_PASSWORD,
  });
  console.log(`Administrador creado: ${datos.ADMIN_CORREO.toLowerCase()}`);
} catch (error) {
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) console.error(`${issue.path.join(".")}: ${issue.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
} finally {
  await database.close();
}
