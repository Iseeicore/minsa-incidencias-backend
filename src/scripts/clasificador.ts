// Trabajador clasificador (B1): toma las incidencias REGISTRADO sin categoría de la IA, las analiza (reglas y V2C con Ollama local) y
// escribe el resultado. Uso (con la base y Ollama en marcha):
//   npm run build && npm run clasificador            (corre hasta que lo detengan; Ctrl+C termina el caso en curso y sale)
//   npm run clasificador -- --una-vez                (vacía la cola una vez y sale)
// Solo escribe `chatbot.incidencia_analisis` y las columnas de la IA de `incidencia_paciente`, con el actor `sistema:clasificador`.
// No registra textos de ciudadanos: solo códigos de caso y cantidades.
import { loadEnv } from "@/config/env.js";
import { createLogger } from "@/config/logger.js";
import { INTERVALO_SONDEO_MS } from "@/constants/clasificador.js";
import { createPgDatabase } from "@/database/pg-database.js";
import {
  ClasificadorIncidencias,
  consultarAlarmaSinClasificar,
  vaciarCola,
} from "@/services/clasificador/clasificador.service.js";
import { crearAnalizadorDeProduccion } from "@/services/clasificador/analizador-produccion.js";

const env = loadEnv();
const logger = createLogger(env);
const database = createPgDatabase(env, logger);
const unaVez = process.argv.includes("--una-vez");

let parar = false;
for (const senal of ["SIGINT", "SIGTERM"] as const)
  process.on(senal, () => {
    parar = true;
  });

const dormir = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

const { analizar, modelo } = crearAnalizadorDeProduccion({
  url: env.OLLAMA_URL,
});
const clasificador = new ClasificadorIncidencias({
  database,
  analizar,
  modelo,
});

try {
  logger.info({ modelo, unaVez }, "clasificador iniciado");
  while (!parar) {
    const resumen = await vaciarCola(clasificador);
    if (resumen.clasificadas > 0 || resumen.fallos > 0)
      logger.info(resumen, "ciclo del clasificador");
    const alarma = await consultarAlarmaSinClasificar(database);
    if (alarma.activa)
      logger.warn(
        {
          atrasados: alarma.atrasados,
          minutosDelMasAntiguo: alarma.minutosDelMasAntiguo,
          codigos: alarma.codigos,
          abandonados: clasificador.abandonados.length,
        },
        "ALARMA: incidencias sin clasificar por más del umbral",
      );
    if (unaVez) break;
    await dormir(INTERVALO_SONDEO_MS);
  }
} catch (error) {
  logger.error(
    { err: error instanceof Error ? error.name : "error" },
    "el clasificador se detuvo por un error",
  );
  process.exitCode = 1;
} finally {
  await database.close();
  logger.info("clasificador detenido");
}
