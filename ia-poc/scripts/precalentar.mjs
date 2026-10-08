// Carga el modelo en memoria y lo deja listo antes de una demostración: la primera llamada en frío tarda unos 2 minutos.
import { readFileSync } from "node:fs";

const parametros = JSON.parse(readFileSync(new URL("../modelo/parametros.json", import.meta.url), "utf8"));
const inicio = Date.now();

const respuesta = await fetch(`${parametros.servidor}/api/generate`, {
  method: "POST",
  body: JSON.stringify({ model: parametros.modelo, prompt: "ok", stream: false, think: parametros.think, keep_alive: parametros.keep_alive, options: { ...parametros.options, num_predict: 1 } }),
});
const datos = await respuesta.json();
if (datos.error) {
  console.error(`No se pudo cargar ${parametros.modelo}: ${datos.error}`);
  process.exit(1);
}
console.log(`${parametros.modelo} listo en ${((Date.now() - inicio) / 1000).toFixed(1)} s y se mantiene ${parametros.keep_alive}.`);
