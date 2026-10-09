// Genera src/services/filtro-corrupcion/catalogo-entidades.data.ts desde las secciones 1 (Titulares, con la columna "Destino si la
// denuncia es contra el titular") y 2 (Contactos de derivación) de la nota del vault "Catálogo de entidades y titulares - Denuncias de corrupción", mezclando los alias
// escritos a mano de ia-poc/datos/alias-entidades.json.
//
// Uso (desde la raíz del repo):  node ia-poc/scripts/generar-catalogo.mjs [ruta-a-la-nota.md]
// Sin argumento usa la variable CATALOGO_NOTA o la ruta del vault en Documentos del usuario.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";

const RAIZ = new URL("../../", import.meta.url);
const SALIDA = new URL("src/services/filtro-corrupcion/catalogo-entidades.data.ts", RAIZ);
const ALIAS = new URL("ia-poc/datos/alias-entidades.json", RAIZ);
const NOTA_POR_DEFECTO = join(
  homedir(),
  "Documents",
  "Obsidian Vault",
  "Base de dato",
  "Plataforma de gestión",
  "Catálogo de entidades y titulares - Denuncias de corrupción.md",
);
const NOTA = process.argv[2] ?? process.env.CATALOGO_NOTA ?? NOTA_POR_DEFECTO;

const SIN_DATO = "(no figura)";
const SIN_CORREO = new Set(["(sin correo)", "(ver hoja de MINSA)"]);
const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "en"]);

/** Cargos que la nota (Decisiones) y el léxico (sección 6) aceptan como cargo máximo, según la clase de entidad. */
const CARGOS_MAXIMOS_POR_TIPO = {
  MINISTERIO: ["Ministro de Salud"],
  SIS: ["Jefe del SIS", "Jefe Institucional"],
  FONDO: ["Jefe Institucional"],
  INSTITUTO: ["Director General", "Director Ejecutivo", "Jefe Institucional", "Presidente Ejecutivo"],
  HOSPITAL: ["Director General", "Director Ejecutivo", "Director del Hospital"],
  DIRIS: ["Director General", "Director de la DIRIS"],
  ORGANISMO: ["Superintendente", "Jefe Institucional"],
  CENTRO: ["Director General", "Director Ejecutivo"],
  PROGRAMA: ["Coordinador General", "Director Ejecutivo"],
};

/** Clase de entidad según el comienzo del nombre oficial. Un nombre sin regla detiene el generador: hay que decidir. */
const TIPOS_POR_NOMBRE = [
  [/^ministerio\b/, "MINISTERIO"],
  [/^seguro integral de salud\b/, "SIS"],
  [/^fondo\b/, "FONDO"],
  [/^instituto\b/, "INSTITUTO"],
  [/^hospital\b/, "HOSPITAL"],
  [/^direccion general de redes integradas\b/, "DIRIS"],
  [/^superintendencia\b/, "ORGANISMO"],
  [/^centro nacional\b/, "CENTRO"],
  [/^programa nacional\b/, "PROGRAMA"],
];

/**
 * Destino de la denuncia contra el titular (nota, sección 1): prefijo del texto, normalizado, y entidad del catálogo a la
 * que apunta. ST PAD MINSA es un órgano del MINSA, no una entidad del catálogo: apunta a `minsa`. El destino del MINSA
 * ("Servidores y funcionarios de todos los órganos...") no es una entidad: solo texto. Un destino sin regla detiene el generador.
 */
const DESTINOS_TITULAR = [
  [/^sis\b/, "sis"],
  [/^st pad minsa\b/, "minsa"],
  [/^diris lima este\b/, "diris-le"],
  [/^diris lima norte\b/, "diris-ln"],
  [/^diris lima centro\b/, "diris-lc"],
  [/^diris lima sur\b/, "diris-ls"],
  [/^servidores y funcionarios\b/, null],
];

const CONTACTOS = [
  ["OCI", 2],
  ["SECRETARIA_TECNICA_PAD", 3],
  ["INTEGRIDAD", 4],
  ["PROCURADOR", 5],
];

const normalizar = (texto) =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const falla = (mensaje) => {
  console.error(`generar-catalogo: ${mensaje}`);
  process.exit(1);
};

function seccion(texto, titulo) {
  const inicio = texto.indexOf(`\n## ${titulo}`);
  if (inicio < 0) falla(`no encuentro la sección "${titulo}" en la nota`);
  const resto = texto.slice(inicio + 1);
  const fin = resto.indexOf("\n## ", 1);
  return fin < 0 ? resto : resto.slice(0, fin);
}

/** Filas de la tabla de una sección: celdas ya recortadas, sin cabecera ni separador. */
function filas(textoSeccion) {
  return textoSeccion
    .split("\n")
    .filter((linea) => linea.startsWith("|"))
    .map((linea) =>
      linea
        .trim()
        .slice(1, -1)
        .split("|")
        .map((celda) => celda.trim()),
    )
    .filter((celdas) => celdas[0] !== "N°" && !/^-+$/.test(celdas[0] ?? ""));
}

const titleCase = (texto) =>
  texto
    .toLowerCase()
    .split(" ")
    .map((palabra, i) => (i > 0 && MINUSCULAS.has(palabra) ? palabra : palabra.charAt(0).toUpperCase() + palabra.slice(1)))
    .join(" ");

function limpiarNombre(nombre, sigla) {
  let limpio = nombre;
  for (const sufijo of [` - ${sigla}`, ` ${sigla}`]) {
    if (limpio.endsWith(sufijo)) limpio = limpio.slice(0, -sufijo.length);
  }
  return limpio === limpio.toUpperCase() ? titleCase(limpio) : limpio;
}

const siglaLimpia = (sigla) => sigla.replace(/\s*".*$/, "").trim();

const slug = (sigla) => normalizar(siglaLimpia(sigla).replace(/\./g, "")).replace(/ /g, "-");

function tipoDe(nombre) {
  const normalizado = normalizar(nombre);
  const regla = TIPOS_POR_NOMBRE.find(([patron]) => patron.test(normalizado));
  if (!regla) falla(`sin clase de entidad para "${nombre}": agrégala en TIPOS_POR_NOMBRE`);
  return regla[1];
}

function destinoSiTitular(celda, contexto) {
  if (celda === "" || celda === SIN_DATO) return null;
  const regla = DESTINOS_TITULAR.find(([patron]) => patron.test(normalizar(celda)));
  if (!regla) falla(`destino sin regla en ${contexto}: "${celda}". Agrégalo en DESTINOS_TITULAR`);
  return { texto: celda, entidadDestinoCodigo: regla[1] };
}

function parsearContactos(celda, contexto) {
  if (celda === SIN_DATO) return null;
  return celda.split(/<br\s*\/?>/).map((entrada) => {
    const partes = entrada.split(" / ").map((parte) => parte.trim());
    if (partes.length !== 3) falla(`contacto con formato inesperado en ${contexto}: "${entrada}"`);
    const [nombre, cargo, correo] = partes;
    return { nombre, cargo, correo: SIN_CORREO.has(correo) ? null : correo };
  });
}

function huecosDe({ titularNombre, notaTitular, contactos, notaContactos }) {
  const huecos = [];
  if (!titularNombre) huecos.push("SIN_NOMBRE_TITULAR");
  if (/confirmar/i.test(notaTitular)) huecos.push("TITULAR_POR_CONFIRMAR");
  for (const [tipo] of CONTACTOS) if (contactos[tipo] === null) huecos.push(`SIN_${tipo}`);
  if (CONTACTOS.every(([tipo]) => contactos[tipo] === null)) huecos.push("SIN_CONTACTOS");
  if (/solo se leyeron/i.test(notaContactos)) huecos.push("DIRECTORIO_INCOMPLETO");
  return huecos;
}

const nota = readFileSync(NOTA, "utf8");
const fechaLectura = /Leído el \*\*(\d{4}-\d{2}-\d{2})\*\*/.exec(nota)?.[1] ?? "fecha desconocida";
const manual = JSON.parse(readFileSync(ALIAS, "utf8"));
const excluidas = new Set(Object.keys(manual.excluirSiglas).filter((clave) => clave !== "_comentario"));

const titulares = filas(seccion(nota, "1. Titulares"));
const contactosPorNumero = new Map(filas(seccion(nota, "2. Contactos de derivación")).map((celdas) => [celdas[0], celdas]));

const aliasManualesUsados = [];
const entidades = titulares.map((celdas) => {
  const [numero, entidadCelda, sigla, destinoCelda = "", cargo, titularNombre = "", notaTitular = ""] = celdas;
  const filaContactos = contactosPorNumero.get(numero);
  if (!filaContactos) falla(`la entidad ${numero} no tiene fila en la sección 2`);
  if (filaContactos[1] !== sigla)
    falla(`las siglas de la entidad ${numero} no coinciden entre secciones: "${sigla}" y "${filaContactos[1]}"`);

  const codigo = slug(sigla);
  const nombre = limpiarNombre(entidadCelda, sigla);
  const tipo = tipoDe(nombre);
  const contactos = Object.fromEntries(
    CONTACTOS.map(([tipoContacto, columna]) => [tipoContacto, parsearContactos(filaContactos[columna], `${numero}/${tipoContacto}`)]),
  );
  const aliasManual = manual.alias[codigo] ?? [];
  aliasManualesUsados.push(...aliasManual.map((alias) => `${codigo}: ${alias}`));
  const alias = [...new Set([...(excluidas.has(sigla) ? [] : [siglaLimpia(sigla)]), ...aliasManual])];

  const destino = destinoSiTitular(destinoCelda, numero);
  // MINSA no trae cargo en la tabla ("Ver la hoja...") y el Ministro está excluido de la regla de destino: se toma el cargo máximo de la clase.
  const cargoOficial = /^ver la hoja/i.test(cargo) ? CARGOS_MAXIMOS_POR_TIPO[tipo][0] : cargo;
  const cargosEquivalentes = CARGOS_MAXIMOS_POR_TIPO[tipo].filter((c) => normalizar(c) !== normalizar(cargoOficial));
  return {
    codigo,
    nombre,
    tipo,
    alias,
    titular: { cargo: cargoOficial, cargosEquivalentes, nombre: titularNombre === "" ? null : titularNombre },
    destinoSiTitular: destino,
    contactos,
    huecos: huecosDe({ titularNombre, notaTitular, contactos, notaContactos: filaContactos[6] ?? "" }),
  };
});

// Dos entidades no pueden compartir una misma forma de nombrarlas: el filtro no sabría cuál elegir.
const duenos = new Map();
for (const { codigo, nombre, alias } of entidades) {
  for (const forma of new Set([nombre, ...alias].map(normalizar))) {
    const otro = duenos.get(forma);
    if (otro && otro !== codigo) falla(`"${forma}" nombra a ${otro} y a ${codigo}`);
    duenos.set(forma, codigo);
  }
}
if (new Set(entidades.map(({ codigo }) => codigo)).size !== entidades.length) falla("hay códigos repetidos");
const codigos = new Set(entidades.map(({ codigo }) => codigo));
for (const { codigo, destinoSiTitular: d } of entidades)
  if (d?.entidadDestinoCodigo && !codigos.has(d.entidadDestinoCodigo))
    falla(`el destino de ${codigo} apunta a "${d.entidadDestinoCodigo}", que no está en el catálogo`);

const literal = (valor) => JSON.stringify(valor);
const entidadComoTs = ({ codigo, nombre, tipo, alias, titular, destinoSiTitular: destino, contactos, huecos }) => `{
  codigo: ${literal(codigo)},
  nombre: ${literal(nombre)},
  tipo: TipoEntidad.${tipo},
  alias: ${literal(alias)},
  titular: ${literal(titular)},
  destinoSiTitular: ${literal(destino)},
  contactos: ${literal(contactos)},
  huecos: [${huecos.map((hueco) => `HuecoCatalogo.${hueco}`).join(", ")}],
}`;

const codigoTs = `// Generado por ia-poc/scripts/generar-catalogo.mjs; no editar a mano.
// Fuente: nota "Catálogo de entidades y titulares - Denuncias de corrupción" (destino de la denuncia contra el titular y
// directorios de gob.pe leídos el ${fechaLectura}) y ia-poc/datos/alias-entidades.json.
// Los nombres de los titulares rotan: solo se comparan como señal informativa, nunca deciden.
import { HuecoCatalogo, TipoEntidad } from "@/enums/filtro-corrupcion.enum.js";
import type { EntidadCatalogo } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

export const CATALOGO_ENTIDADES: readonly EntidadCatalogo[] = [
${entidades.map(entidadComoTs).join(",\n")},
];
`;

const configuracion = (await resolveConfig(SALIDA.pathname)) ?? {};
writeFileSync(SALIDA, await format(codigoTs, { ...configuracion, parser: "typescript", printWidth: 140 }));

const sinDestino = entidades.filter(({ destinoSiTitular: d }) => d === null).map(({ codigo }) => codigo);
console.log(`Con destino si la denuncia es contra el titular: ${entidades.length - sinDestino.length}; sin destino: ${sinDestino.join(", ") || "ninguna"}`);
const conHuecos = entidades.filter(({ huecos }) => huecos.length > 0);
console.log(`${entidades.length} entidades escritas en src/services/filtro-corrupcion/catalogo-entidades.data.ts`);
console.log(`Alias manuales mezclados (${aliasManualesUsados.length}): ${aliasManualesUsados.join(" | ")}`);
console.log(`Con huecos (${conHuecos.length}):`);
for (const { codigo, huecos } of conHuecos) console.log(`  ${codigo}: ${huecos.join(", ")}`);
