// Validación básica de un archivo de mensajes de prueba en JSON Lines (un objeto por línea).
// Uso: node ia-poc/scripts/validar-mensajes.mjs ruta/al/archivo.jsonl [ruta/de/salida-limpia.jsonl] [--reasignar-ids=PREFIJO] [--excluir-textos-de=otro.jsonl] [--excluir-textos-de=otro2.jsonl] [--ocultar-textos]
// Con --ocultar-textos no imprime ningún fragmento de texto (ni en los problemas): sirve para validar un conjunto limpio (T2) sin leerlo.
// Campos de la versión 2 del prompt (entidad_mencionada, sigla, contra_titular, destino_titular_esperado, ubicacion_mencionada): se aceptan y se copian tal cual; solo se comprueba su tipo.
// Con --excluir-textos-de descarta los mensajes cuyo texto ya está en el otro archivo (evita que la prueba se cuele en desarrollo).
// Tolera objetos pegados en una misma línea (los modelos chicos a veces omiten el salto de línea) y bloques con texto extra.
// Con --reasignar-ids=PREFIJO numera los mensajes válidos como PREFIJO-001, PREFIJO-002… (los ids repetidos entre tandas no son un error grave).
// Comprueba formato, categorías, coherencia del destino, duplicados y que el RENIPRESS exista en la lista conocida.
import { readFileSync, writeFileSync } from "node:fs";

const CATEGORIAS = new Set(["DENUNCIA_CORRUPCION", "QUEJA", "RECLAMO", "OTRO"]);
const DIFICULTADES = new Set(["facil", "media", "dificil"]);
const RENIPRESS = {
  "6206": "Hospital Nacional Dos de Mayo",
  "5946": "Hospital Nacional Hipolito Unanue",
  "6215": "Hospital Nacional Docente Madre Nino San Bartolome",
  "33381": "Hospital de Lima Este - Vitarte",
  "5614": "Centro de Salud Bayovar",
  "5862": "Centro de Salud Chosica",
  "5863": "Centro de Salud Nicolas de Pierola",
  "5864": "Centro de Salud San Antonio de Pedregal",
  "5865": "Puesto de Salud Chacrasana",
  "5967": "7 de Octubre",
};
const normalizar = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const argumentos = process.argv.slice(2);
const prefijoIds = argumentos.find((a) => a.startsWith("--reasignar-ids="))?.split("=")[1] ?? null;
const archivosAExcluir = argumentos.filter((a) => a.startsWith("--excluir-textos-de=")).map((a) => a.split("=")[1]);
const ocultarTextos = argumentos.includes("--ocultar-textos");
const [entrada, salida] = argumentos.filter((a) => !a.startsWith("--"));
/** Fragmento de texto para los mensajes de problemas; con --ocultar-textos no se muestra nada. */
const fragmento = (texto, largo) => (ocultarTextos ? "[texto oculto]" : String(texto ?? "").slice(0, largo));
const CAMPOS_TEXTO_DE_LA_V2 = ["entidad_mencionada", "sigla", "destino_titular_esperado", "ubicacion_mencionada"];
if (!entrada) {
  console.error("Falta la ruta del archivo .jsonl");
  process.exit(2);
}

/** Extrae los objetos JSON de primer nivel de un texto, aunque estén pegados o separados por texto extra. */
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
      if (profundidad === 0) objetos.push(texto.slice(inicio, i + 1));
    }
  }
  return objetos;
}

const contenido = readFileSync(entrada, "utf8");
const lineas = extraerObjetos(contenido).map((crudo, k) => ({ n: k + 1, crudo }));
const lineasPorSalto = contenido.split(/\r?\n/).filter((l) => l.trim() !== "").length;
const validos = [];
const problemas = [];
const vistosId = new Map();
let idsRepetidos = 0;
const vistosTexto = new Map();
// Textos que ya pertenecen a otro conjunto (p. ej. la prueba): un mensaje repetido allí no puede estar también en desarrollo.
const textosAExcluir = new Set(
  archivosAExcluir.flatMap((archivo) =>
    extraerObjetos(readFileSync(archivo, "utf8")).flatMap((crudo) => {
      try {
        return [normalizar(JSON.parse(crudo).texto ?? "")];
      } catch {
        return [];
      }
    }),
  ),
);
let excluidosPorRepetidos = 0;

lineas.forEach(({ n, crudo: linea }) => {
  let m;
  try {
    m = JSON.parse(linea);
  } catch {
    problemas.push([n, "JSON inválido (línea cortada, texto extra o comillas)", fragmento(linea, 60)]);
    return;
  }
  if (textosAExcluir.has(normalizar(m.texto ?? ""))) {
    excluidosPorRepetidos++;
    return;
  }
  const falla = [];
  if (typeof m.texto !== "string" || m.texto.trim().length === 0) falla.push("sin texto");
  if (!CATEGORIAS.has(m.categoria_esperada)) falla.push(`categoría inválida (${m.categoria_esperada})`);
  const destinoOk = m.categoria_esperada === "DENUNCIA_CORRUPCION" ? "OTRANS" : "ESTABLECIMIENTO";
  if (m.destino_esperado !== destinoOk) falla.push(`destino incoherente (esperado ${destinoOk}, vino ${m.destino_esperado})`);
  if (m.renipress != null && !RENIPRESS[String(m.renipress)]) falla.push(`RENIPRESS desconocido (${m.renipress})`);
  if (m.renipress != null && RENIPRESS[String(m.renipress)] && m.establecimiento && normalizar(m.establecimiento) !== normalizar(RENIPRESS[String(m.renipress)])) falla.push("nombre del establecimiento no coincide con su RENIPRESS");
  if (typeof m.anonimo !== "boolean") falla.push("`anonimo` no es booleano");
  for (const campo of CAMPOS_TEXTO_DE_LA_V2) if (m[campo] != null && typeof m[campo] !== "string") falla.push(`\`${campo}\` no es texto`);
  if (m.contra_titular != null && typeof m.contra_titular !== "boolean") falla.push("`contra_titular` no es booleano");
  if (m.dificultad != null && !DIFICULTADES.has(m.dificultad)) falla.push(`dificultad inválida (${m.dificultad})`);
  if (typeof m.texto === "string" && m.texto.trim().length < 20 && m.categoria_esperada !== "OTRO") falla.push("texto de menos de 20 caracteres con categoría distinta de OTRO (revisar)");
  if (m.id != null) {
    if (vistosId.has(m.id)) idsRepetidos++;
    else vistosId.set(m.id, n);
  } else falla.push("sin id");
  const clave = normalizar(m.texto ?? "");
  if (clave && vistosTexto.has(clave)) falla.push(`texto duplicado de la línea ${vistosTexto.get(clave)}`);
  else if (clave) vistosTexto.set(clave, n);
  if (falla.length) problemas.push([n, falla.join("; "), fragmento(m.texto, 60)]);
  else validos.push(m);
});

const cuenta = (campo, lista) => lista.reduce((a, m) => ((a[m[campo] ?? "(vacío)"] = (a[m[campo] ?? "(vacío)"] ?? 0) + 1), a), {});
console.log(`Líneas con contenido: ${lineasPorSalto} | objetos JSON encontrados: ${lineas.length}${lineas.length !== lineasPorSalto ? " (hay objetos pegados en una línea)" : ""} | válidos: ${validos.length} | con problemas: ${problemas.length}`);
if (archivosAExcluir.length > 0) console.log(`Excluidos por estar también en ${archivosAExcluir.join(" o ")}: ${excluidosPorRepetidos}`);
console.log("Categorías (válidas):", JSON.stringify(cuenta("categoria_esperada", validos)));
console.log("Dificultad:", JSON.stringify(cuenta("dificultad", validos)));
console.log("Anónimos:", validos.filter((m) => m.anonimo).length, "| con cargo mencionado:", validos.filter((m) => m.cargo_mencionado).length, "| con nombre mencionado:", validos.filter((m) => m.nombre_mencionado).length);
console.log("Con entidad etiquetada:", validos.filter((m) => m.sigla).length, "| contra el titular:", validos.filter((m) => m.contra_titular === true).length, "| con ubicación:", validos.filter((m) => m.ubicacion_mencionada).length);
console.log("Siglas:", JSON.stringify(cuenta("sigla", validos)));
console.log("Establecimientos:", JSON.stringify(cuenta("establecimiento", validos)));
console.log("Estilos:", JSON.stringify(cuenta("estilo", validos)));
if (problemas.length) {
  console.log("\nProblemas:");
  problemas.slice(0, 40).forEach(([n, motivo, texto]) => console.log(`  línea ${n}: ${motivo}${ocultarTextos ? "" : ` «${texto}»`}`));
  if (problemas.length > 40) console.log(`  … y ${problemas.length - 40} más`);
}
if (salida) {
  const aGuardar = prefijoIds
    ? validos.map((m, i) => ({ ...m, id: `${prefijoIds}-${String(i + 1).padStart(Math.max(3, String(validos.length).length), "0")}` }))
    : validos;
  writeFileSync(salida, aGuardar.map((m) => JSON.stringify(m)).join("\n") + "\n");
  console.log(`\nVálidas guardadas en ${salida}`);
}
