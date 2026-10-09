// Calienta el prefijo de una variante: hace UNA llamada real con su prompt del sistema y un mensaje inventado, sin tocar ninguna caché.
// Uso (después de `node ia-poc/scripts/precalentar.mjs`):  npx tsx ia-poc/scripts/precalentar-variante.ts --variante=V2C
// Así la primera llamada medida de una corrida ya no paga el procesamiento del prefijo.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VarianteIa } from "@/enums/analisis-ia.enum.js";
import { crearClienteOllama } from "@/services/analisis-ia/cliente-ollama.js";
import { construirPeticion } from "@/services/analisis-ia/prompts.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

const MENSAJE_DE_CALENTAMIENTO =
  "Quiero saber a qué hora abre la farmacia del hospital por las tardes y si atienden los domingos";

const variante = process.argv
  .slice(2)
  .find((a) => a.startsWith("--variante="))
  ?.slice("--variante=".length) as VarianteIa | undefined;
if (!variante || !Object.values(VarianteIa).includes(variante)) {
  console.error("Uso: --variante=V1|V2|V3|V2C");
  process.exit(2);
}

const parametros = JSON.parse(
  readFileSync(resolve("ia-poc/modelo/parametros.json"), "utf8"),
) as {
  modelo: string;
  servidor: string;
  keep_alive: string;
  options: Record<string, number>;
};
const cliente = crearClienteOllama({
  modelo: parametros.modelo,
  url: parametros.servidor,
  keepAlive: parametros.keep_alive,
  opciones: parametros.options,
});
const peticion = construirPeticion(
  variante,
  MENSAJE_DE_CALENTAMIENTO,
  evaluarTextoCorrupcion(MENSAJE_DE_CALENTAMIENTO),
);
const inicio = Date.now();
const resultado = await cliente.consultar(peticion);
console.log(
  resultado.ok
    ? `${variante} calentada en ${((Date.now() - inicio) / 1000).toFixed(1)} s (proceso del prompt ${resultado.metricas.procesoPromptMs} ms, ${resultado.metricas.tokensSalida} tokens de salida).`
    : `No se pudo calentar ${variante}: ${resultado.motivo}`,
);
process.exit(resultado.ok ? 0 : 1);
