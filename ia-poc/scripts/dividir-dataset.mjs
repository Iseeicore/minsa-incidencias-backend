// Divide un dataset de mensajes (JSON Lines) en desarrollo, prueba y reserva, de forma reproducible.
// Uso: node ia-poc/scripts/dividir-dataset.mjs ENTRADA.jsonl [--semilla=7] [--desarrollo=300] [--prueba=400] [--reserva=300] [--salida=ia-poc/evaluacion] [--sufijo=v2]
//
// Reglas que evitan contaminar la prueba:
//  1. Los mensajes casi iguales (similitud de trigramas de palabras >= 0.5) forman un grupo y caen SIEMPRE en el mismo conjunto.
//  2. El reparto se estratifica por `tipo_caso` (o por `categoria_esperada` si no existe), así cada conjunto conserva la mezcla.
//  3. Con la misma semilla el resultado es idéntico.
// Se informa además cuántos mensajes se parecen a los de otros conjuntos ya existentes en la carpeta de salida (fuga entre archivos).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argumentos = process.argv.slice(2);
const opcion = (nombre, porDefecto) => argumentos.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1] ?? porDefecto;
const entrada = argumentos.find((a) => !a.startsWith("--"));
if (!entrada) {
  console.error("Falta la ruta del archivo .jsonl");
  process.exit(2);
}
const semilla = Number(opcion("semilla", "7"));
const objetivos = { desarrollo: Number(opcion("desarrollo", "300")), prueba: Number(opcion("prueba", "400")), reserva: Number(opcion("reserva", "300")) };
const carpeta = opcion("salida", "ia-poc/evaluacion");
const sufijo = opcion("sufijo", "v2");
const UMBRAL_PARECIDO = 0.5;

const normalizar = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function extraerObjetos(texto) {
  const objetos = [];
  let profundidad = 0;
  let enCadena = false;
  let escape = false;
  let inicio = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"' && profundidad > 0) enCadena = true;
    else if (c === "{") {
      if (profundidad === 0) inicio = i;
      profundidad++;
    } else if (c === "}" && profundidad > 0) {
      profundidad--;
      if (profundidad === 0) {
        try {
          objetos.push(JSON.parse(texto.slice(inicio, i + 1)));
        } catch {
          /* se ignora un objeto ilegible */
        }
      }
    }
  }
  return objetos;
}

const leer = (ruta) => extraerObjetos(readFileSync(ruta, "utf8"));
const trigramas = (t) => {
  const palabras = normalizar(t).split(" ");
  const conjunto = new Set();
  for (let i = 0; i + 2 < palabras.length; i++) conjunto.add(palabras.slice(i, i + 3).join(" "));
  return conjunto;
};
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return comunes / (a.size + b.size - comunes);
};

// Generador pseudoaleatorio con semilla (mulberry32).
function aleatorio(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = aleatorio(semilla);
const barajar = (lista) => {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
};

const mensajes = leer(entrada);
if (mensajes.length === 0) {
  console.error("No se encontró ningún mensaje legible.");
  process.exit(1);
}
const total = Object.values(objetivos).reduce((a, b) => a + b, 0);
if (total !== mensajes.length) console.warn(`Aviso: los objetivos suman ${total} y el archivo tiene ${mensajes.length}; se reparte en proporción.`);

// 1) Grupos de mensajes parecidos (unión de componentes).
const tri = mensajes.map((m) => trigramas(m.texto));
const padre = mensajes.map((_, i) => i);
const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
for (let i = 0; i < mensajes.length; i++) for (let j = i + 1; j < mensajes.length; j++) if (jaccard(tri[i], tri[j]) >= UMBRAL_PARECIDO) padre[raiz(j)] = raiz(i);
const grupos = new Map();
mensajes.forEach((_, i) => grupos.set(raiz(i), [...(grupos.get(raiz(i)) ?? []), i]));

// 2) Estrato de cada grupo = el estrato más frecuente entre sus mensajes.
const estratoDe = (m) => m.tipo_caso ?? m.categoria_esperada ?? "sin-estrato";
const porEstrato = new Map();
for (const miembros of grupos.values()) {
  const cuenta = {};
  miembros.forEach((i) => (cuenta[estratoDe(mensajes[i])] = (cuenta[estratoDe(mensajes[i])] ?? 0) + 1));
  const estrato = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0][0];
  porEstrato.set(estrato, [...(porEstrato.get(estrato) ?? []), miembros]);
}

// 3) Reparto: cada grupo va al conjunto que está más lejos de su objetivo proporcional dentro del estrato.
const nombres = Object.keys(objetivos);
const asignados = Object.fromEntries(nombres.map((n) => [n, []]));
const proporcion = Object.fromEntries(nombres.map((n) => [n, objetivos[n] / total]));
for (const [, listaGrupos] of [...porEstrato.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const cuantos = Object.fromEntries(nombres.map((n) => [n, 0]));
  const tamanoEstrato = listaGrupos.reduce((suma, g) => suma + g.length, 0);
  for (const grupo of barajar(listaGrupos).sort((a, b) => b.length - a.length)) {
    const destino = [...nombres].sort((a, b) => cuantos[a] / (proporcion[a] * tamanoEstrato) - cuantos[b] / (proporcion[b] * tamanoEstrato))[0];
    asignados[destino].push(...grupo);
    cuantos[destino] += grupo.length;
  }
}

// 4) Verificación: ningún par parecido atraviesa conjuntos.
const conjuntoDe = new Map();
nombres.forEach((n) => asignados[n].forEach((i) => conjuntoDe.set(i, n)));
let fugas = 0;
for (let i = 0; i < mensajes.length; i++) for (let j = i + 1; j < mensajes.length; j++) if (conjuntoDe.get(i) !== conjuntoDe.get(j) && jaccard(tri[i], tri[j]) >= UMBRAL_PARECIDO) fugas++;

// 5) Parecidos con archivos ya existentes (otros dataset de la carpeta).
const existentes = ["desarrollo.jsonl", "prueba-t1.jsonl"].map((n) => join(carpeta, n)).filter(existsSync);
const parecidosConExistentes = {};
for (const ruta of existentes) {
  const otros = leer(ruta).map((m) => trigramas(m.texto));
  const cuenta = Object.fromEntries(nombres.map((n) => [n, 0]));
  mensajes.forEach((_, i) => {
    if (otros.some((o) => jaccard(tri[i], o) >= UMBRAL_PARECIDO)) cuenta[conjuntoDe.get(i)]++;
  });
  parecidosConExistentes[ruta] = cuenta;
}

// 6) Escritura y resumen.
const resumen = {};
for (const n of nombres) {
  const ordenados = asignados[n].sort((a, b) => a - b).map((i) => mensajes[i]);
  writeFileSync(join(carpeta, `${n}-${sufijo}.jsonl`), ordenados.map((m) => JSON.stringify(m)).join("\n") + "\n");
  const contar = (campo) => ordenados.reduce((r, m) => ((r[m[campo] ?? "(vacío)"] = (r[m[campo] ?? "(vacío)"] ?? 0) + 1), r), {});
  resumen[n] = { mensajes: ordenados.length, porCategoria: contar("categoria_esperada"), porTipoCaso: contar("tipo_caso"), porDificultad: contar("dificultad") };
}
console.log(`Semilla ${semilla} | mensajes ${mensajes.length} | grupos de parecidos ${grupos.size} (con más de un mensaje: ${[...grupos.values()].filter((g) => g.length > 1).length})`);
console.log(JSON.stringify(resumen, null, 1));
console.log(`Pares parecidos que cruzan conjuntos (debe ser 0): ${fugas}`);
console.log("Mensajes parecidos a los de archivos anteriores:", JSON.stringify(parecidosConExistentes));
