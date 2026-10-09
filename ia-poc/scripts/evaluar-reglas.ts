// Evalúa el filtro de corrupción por reglas contra un conjunto de mensajes etiquetados (JSON Lines).
// Uso (desde la raíz del repo):  npx tsx ia-poc/scripts/evaluar-reglas.ts ia-poc/evaluacion/desarrollo.jsonl [--json=salida.json] [--sin-listas]
// Positivo = `categoria_esperada` DENUNCIA_CORRUPCION; "predicho" = `propuestaCorrupcion` del filtro. Solo lee el texto (sin contexto).
// Zona gris: el filtro pidió segunda opinión (`requiereSegundaOpinion`) o quedó a un punto de proponer corrupción con alguna señal.
import { readFileSync, writeFileSync } from "node:fs";
import { UMBRAL_CERTEZA_MEDIA, TIPOS_DE_SENAL_DE_CORRUPCION } from "@/constants/filtro-corrupcion.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";
import type { ResultadoCorrupcion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

interface Mensaje {
  id: string;
  texto: string;
  categoria_esperada: string;
  dificultad?: string | null;
  estilo?: string | null;
  contra_titular?: boolean | null;
}

interface Evaluado {
  mensaje: Mensaje;
  resultado: ResultadoCorrupcion;
  positivoEsperado: boolean;
  positivoPredicho: boolean;
  enZonaGris: boolean;
}

interface Metricas {
  total: number;
  positivos: number;
  vp: number;
  fn: number;
  fp: number;
  vn: number;
  recall: number | null;
  precision: number | null;
}

const CATEGORIA_POSITIVA = "DENUNCIA_CORRUPCION";

const argumentos = process.argv.slice(2);
const rutaEntrada = argumentos.find((a) => !a.startsWith("--"));
const rutaJson = argumentos.find((a) => a.startsWith("--json="))?.slice("--json=".length);
const sinListas = argumentos.includes("--sin-listas");
if (!rutaEntrada) {
  console.error("Falta la ruta del archivo .jsonl");
  process.exit(2);
}

const leerMensajes = (ruta: string): Mensaje[] =>
  readFileSync(ruta, "utf8")
    .split(/\r?\n/)
    .filter((linea) => linea.trim() !== "")
    .map((linea) => JSON.parse(linea) as Mensaje);

const pedidaSegundaOpinion = (resultado: ResultadoCorrupcion): boolean =>
  (resultado as { requiereSegundaOpinion?: boolean }).requiereSegundaOpinion === true;

function evaluar(mensaje: Mensaje): Evaluado {
  const resultado = evaluarTextoCorrupcion(mensaje.texto);
  const hayEvidencia = resultado.senales.some(({ tipo }) => TIPOS_DE_SENAL_DE_CORRUPCION.includes(tipo));
  const cercaDelUmbral = !resultado.propuestaCorrupcion && hayEvidencia && resultado.puntaje === UMBRAL_CERTEZA_MEDIA - 1;
  return {
    mensaje,
    resultado,
    positivoEsperado: mensaje.categoria_esperada === CATEGORIA_POSITIVA,
    positivoPredicho: resultado.propuestaCorrupcion,
    enZonaGris: pedidaSegundaOpinion(resultado) || cercaDelUmbral,
  };
}

const razon = (numerador: number, denominador: number): number | null => (denominador === 0 ? null : numerador / denominador);

function metricas(evaluados: readonly Evaluado[]): Metricas {
  const vp = evaluados.filter((e) => e.positivoEsperado && e.positivoPredicho).length;
  const fn = evaluados.filter((e) => e.positivoEsperado && !e.positivoPredicho).length;
  const fp = evaluados.filter((e) => !e.positivoEsperado && e.positivoPredicho).length;
  const vn = evaluados.length - vp - fn - fp;
  return { total: evaluados.length, positivos: vp + fn, vp, fn, fp, vn, recall: razon(vp, vp + fn), precision: razon(vp, vp + fp) };
}

const porcentaje = (valor: number | null): string => (valor === null ? "  n/d" : `${(valor * 100).toFixed(1).padStart(5)}%`);

function desglose(titulo: string, evaluados: readonly Evaluado[], clave: (e: Evaluado) => string | null): Record<string, Metricas> | null {
  const grupos = new Map<string, Evaluado[]>();
  for (const e of evaluados) {
    const k = clave(e);
    if (k === null) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), e]);
  }
  if (grupos.size === 0) return null;
  console.log(`\n${titulo}`);
  const salida: Record<string, Metricas> = {};
  for (const [k, lista] of [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const m = metricas(lista);
    salida[k] = m;
    console.log(
      `  ${k.padEnd(14)} n=${String(m.total).padStart(3)}  positivos=${String(m.positivos).padStart(3)}  VP=${m.vp} FN=${m.fn} FP=${m.fp}  recall=${porcentaje(m.recall)}  precision=${porcentaje(m.precision)}`,
    );
  }
  return salida;
}

const estiloBase = (estilo: string | null | undefined): string => {
  const e = (estilo ?? "").toLowerCase();
  if (e.includes("enganoso") || e.includes("engañoso")) return "engañoso";
  if (e.includes("mayuscula")) return "mayúsculas";
  if (e.includes("audio")) return "audio transcrito";
  if (e.includes("jerga")) return "jerga";
  if (e.includes("whatsapp") || e.includes("sin tildes")) return "whatsapp sin tildes";
  if (e.includes("corto")) return "mensaje corto";
  if (e.includes("formal") || e.includes("educado")) return "formal";
  if (e.includes("informal") || e.includes("errores")) return "informal con errores";
  return "otro";
};

const mensajes = leerMensajes(rutaEntrada);
const evaluados = mensajes.map(evaluar);
const general = metricas(evaluados);
const versionReglas = evaluados[0]?.resultado.versionReglas ?? "(sin mensajes)";

console.log(`Archivo: ${rutaEntrada}`);
console.log(`Versión de reglas: ${versionReglas}`);
console.log(`Mensajes: ${general.total} | positivos esperados (corrupción): ${general.positivos} | negativos: ${general.total - general.positivos}`);
console.log(`VP=${general.vp}  FN=${general.fn}  FP=${general.fp}  VN=${general.vn}`);
console.log(`Recall de corrupción: ${porcentaje(general.recall)}   Precisión: ${porcentaje(general.precision)}`);

const porDificultad = desglose("Por dificultad", evaluados, (e) => e.mensaje.dificultad ?? "(sin dato)");
const porEstilo = desglose("Por estilo", evaluados, (e) => estiloBase(e.mensaje.estilo));
const porTitular = desglose("Por contra_titular", evaluados, (e) =>
  e.mensaje.contra_titular === undefined || e.mensaje.contra_titular === null ? null : String(e.mensaje.contra_titular),
);

const distribucion = new Map<number, { esperados: number; otros: number }>();
for (const e of evaluados) {
  const fila = distribucion.get(e.resultado.puntaje) ?? { esperados: 0, otros: 0 };
  if (e.positivoEsperado) fila.esperados++;
  else fila.otros++;
  distribucion.set(e.resultado.puntaje, fila);
}
console.log("\nDistribución de puntajes (puntaje: corrupción esperada / no corrupción)");
for (const [puntaje, { esperados, otros }] of [...distribucion.entries()].sort(([a], [b]) => a - b))
  console.log(`  ${String(puntaje).padStart(3)}: ${String(esperados).padStart(3)} / ${String(otros).padStart(3)}  ${"#".repeat(esperados)}${".".repeat(otros)}`);

const falsosNegativos = evaluados.filter((e) => e.positivoEsperado && !e.positivoPredicho);
const falsosPositivos = evaluados.filter((e) => !e.positivoEsperado && e.positivoPredicho);
const grises = evaluados.filter((e) => e.enZonaGris);
const lineaDe = (e: Evaluado): string =>
  `  ${e.mensaje.id} [puntaje ${e.resultado.puntaje}, esperado ${e.mensaje.categoria_esperada}] ${e.mensaje.texto}`;

console.log(`\nZona gris: ${grises.length} mensajes (${grises.filter((e) => e.positivoEsperado).length} son corrupción esperada)`);
if (!sinListas) {
  console.log(`\nFalsos negativos (${falsosNegativos.length})`);
  falsosNegativos.forEach((e) => console.log(lineaDe(e)));
  console.log(`\nFalsos positivos (${falsosPositivos.length})`);
  falsosPositivos.forEach((e) => console.log(lineaDe(e)));
  console.log(`\nMensajes en zona gris (${grises.length})`);
  grises.forEach((e) => console.log(lineaDe(e)));
}

if (rutaJson) {
  const resumen = {
    archivo: rutaEntrada,
    versionReglas,
    general,
    porDificultad,
    porEstilo,
    porTitular,
    zonaGris: grises.map((e) => e.mensaje.id),
    falsosNegativos: falsosNegativos.map((e) => ({ id: e.mensaje.id, texto: e.mensaje.texto, puntaje: e.resultado.puntaje })),
    falsosPositivos: falsosPositivos.map((e) => ({ id: e.mensaje.id, texto: e.mensaje.texto, puntaje: e.resultado.puntaje })),
  };
  writeFileSync(rutaJson, JSON.stringify(resumen, null, 2) + "\n");
  console.log(`\nResumen guardado en ${rutaJson}`);
}
