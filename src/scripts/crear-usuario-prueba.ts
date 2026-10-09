import { z } from "zod";
import { loadEnv } from "@/config/env.js";
import { createLogger } from "@/config/logger.js";
import { createPgDatabase } from "@/database/pg-database.js";
import {
  crearUsuarioDePrueba,
  leerDatosUsuarioPrueba,
  ResultadoUsuarioPrueba,
} from "@/services/usuario-prueba.service.js";
import { normalizarCorreo } from "@/services/auth.service.js";
import { ArgonPasswordHasher } from "@/utils/password-hasher.js";

try {
  const datos = leerDatosUsuarioPrueba(process.env);
  const env = loadEnv();
  const database = createPgDatabase(env, createLogger(env));
  try {
    const resultado = await crearUsuarioDePrueba(database, new ArgonPasswordHasher(), datos);
    const correo = normalizarCorreo(datos.correo);
    console.log(
      resultado === ResultadoUsuarioPrueba.CREADO
        ? `Usuario de prueba creado: ${correo} (${datos.rol})`
        : `El usuario ya existía y se dejó como estaba: ${correo}`,
    );
  } finally {
    await database.close();
  }
} catch (error) {
  if (error instanceof z.ZodError) {
    for (const issue of error.issues) console.error(`${issue.path.join(".")}: ${issue.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
}
