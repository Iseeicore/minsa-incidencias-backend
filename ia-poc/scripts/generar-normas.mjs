// Genera `src/services/analisis-ia/normas/fragmentos-normas.data.ts` desde `ia-poc/datos/fragmentos-normas.json` (la fuente de verdad).
// Uso (desde la raíz del repo):  node ia-poc/scripts/generar-normas.mjs
// Es reproducible: sin cambios en el JSON vuelve a escribir el mismo archivo. Valida lo básico antes de escribir.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const rutaJson = resolve("ia-poc/datos/fragmentos-normas.json");
const rutaSalida = resolve(
  "src/services/analisis-ia/normas/fragmentos-normas.data.ts",
);
const FUENTES = new Set([
  "DIRECTIVA_002_2023_PCM_SIP",
  "AYUDA_MEMORIA_OTRANS",
]);
const TIPOS = new Set([
  "FALTA",
  "INCONDUCTA",
  "DELITO",
  "DEFINICION",
  "PROCEDIMIENTO",
]);

const datos = JSON.parse(readFileSync(rutaJson, "utf8"));
const errores = [];
const ids = new Set();
for (const f of datos.fragmentos) {
  if (ids.has(f.id)) errores.push(`id repetido: ${f.id}`);
  ids.add(f.id);
  if (!FUENTES.has(f.fuente)) errores.push(`${f.id}: fuente desconocida ${f.fuente}`);
  if (!TIPOS.has(f.tipo)) errores.push(`${f.id}: tipo desconocido ${f.tipo}`);
  if (typeof f.texto !== "string" || f.texto.trim() === "")
    errores.push(`${f.id}: sin texto`);
  if (f.citaAutomatica === false && !f.motivoSinCita)
    errores.push(`${f.id}: citaAutomatica false sin motivoSinCita`);
}
if (typeof datos.transcripcionAnexoCCotejada !== "boolean")
  errores.push("falta transcripcionAnexoCCotejada");
if (errores.length > 0) {
  console.error(errores.join("\n"));
  process.exit(1);
}

const contenido = `// ARCHIVO GENERADO por ia-poc/scripts/generar-normas.mjs desde ia-poc/datos/fragmentos-normas.json. No se edita a mano.
import type { DatosNormas } from "@/services/analisis-ia/normas/normas.types.js";

export const DATOS_NORMAS: DatosNormas = ${JSON.stringify(datos, null, 2)};
`;
writeFileSync(rutaSalida, contenido);
console.log(
  `${datos.fragmentos.length} fragmentos (versión ${datos.version}) escritos en ${rutaSalida}`,
);
