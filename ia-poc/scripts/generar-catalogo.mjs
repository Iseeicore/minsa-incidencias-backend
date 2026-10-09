// Genera src/services/filtro-corrupcion/catalogo-entidades.data.ts desde las secciones 1 (Titulares, con la columna "Destino si la
// denuncia es contra el titular") y 2 (Contactos de derivación) de la nota del vault "Catálogo de entidades y titulares - Denuncias de corrupción", mezclando los alias
// escritos a mano de ia-poc/datos/alias-entidades.json y los alias DERIVADOS del nombre oficial y la sigla (sin "Hospital"/"Nacional"/"de",
// con artículo y con las faltas de ortografía más frecuentes). También genera ubicaciones-entidades.data.ts desde
// ia-poc/datos/ubicaciones-entidades.json y deja en ia-poc/datos/alias-ambiguos.json los alias derivados que se descartaron por ambiguos.
//
// Uso (desde la raíz del repo):  node ia-poc/scripts/generar-catalogo.mjs [ruta-a-la-nota.md]
// Sin argumento usa la variable CATALOGO_NOTA o la ruta del vault en Documentos del usuario.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";

const RAIZ = new URL("../../", import.meta.url);
const SALIDA = new URL("src/services/filtro-corrupcion/catalogo-entidades.data.ts", RAIZ);
const SALIDA_UBICACIONES = new URL("src/services/filtro-corrupcion/ubicaciones-entidades.data.ts", RAIZ);
const SALIDA_AMBIGUOS = new URL("ia-poc/datos/alias-ambiguos.json", RAIZ);
const ALIAS = new URL("ia-poc/datos/alias-entidades.json", RAIZ);
const UBICACIONES = new URL("ia-poc/datos/ubicaciones-entidades.json", RAIZ);
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
 * Códigos de destino válidos que no son una entidad del catálogo: apuntan a un órgano. Deben coincidir con
 * `CODIGO_DESTINO_ST_PAD_MINSA` de `src/constants/filtro-corrupcion.ts`.
 */
const CODIGO_DESTINO_ST_PAD_MINSA = "st-pad-minsa";
const DESTINOS_ESPECIALES = new Set([CODIGO_DESTINO_ST_PAD_MINSA]);

/**
 * Destino de la denuncia contra el titular (nota, sección 1): prefijo del texto, normalizado, y entidad del catálogo a la
 * que apunta. ST PAD MINSA es un órgano del MINSA, no una entidad del catálogo: tiene su propio código de destino especial
 * (`st-pad-minsa`, decisión del 2026-10-08) en vez de apuntar a `minsa`. El destino del MINSA
 * ("Servidores y funcionarios de todos los órganos...") no es una entidad: solo texto. Un destino sin regla detiene el generador.
 */
const DESTINOS_TITULAR = [
  [/^sis\b/, "sis"],
  [/^st pad minsa\b/, CODIGO_DESTINO_ST_PAD_MINSA],
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

// ---- Alias derivados --------------------------------------------------------------------------------------------------------
// Se derivan del nombre oficial y la sigla, nunca frase por frase. Reglas: una palabra común o corta no elige entidad sola; una
// palabra que también es una zona (Huaycán, Chosica...) es ubicación y no alias; si dos entidades comparten un alias derivado no se
// elige ninguna y queda documentado en alias-ambiguos.json.

const ARTICULOS = ["el", "la", "del", "al"];
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "en", "el"]);
/** Palabras que encabezan el nombre oficial y no lo identifican ("Hospital Nacional de Emergencias ..."). */
const INICIALES_GENERICAS = new Set([...PARTICULAS, "hospital", "nacional", "docente", "instituto", "emergencias", "emergencia"]);
const TIPOS_QUE_SE_DERIVAN = new Set(["HOSPITAL", "INSTITUTO"]);
const PREFIJO_POR_TIPO = { HOSPITAL: "hospital", INSTITUTO: "instituto" };
const MINIMO_LETRAS_DISTINTIVA = 5;
const MAXIMO_VARIANTES_POR_PALABRA = 12;

const palabrasDe = (texto) => normalizar(texto).split(" ").filter(Boolean);

/** Variantes de una palabra a un solo cambio de ortografía de distancia (v/b, ll/y, y/i, s/z/c, h muda). */
function vecinos(palabra) {
  const salida = new Set();
  const vocal = (c) => c !== undefined && "aeiou".includes(c);
  const antesDeEI = (i, largo) => ["e", "i"].includes(palabra[i + largo]);
  const cambia = (desde, hasta, condicion = () => true) => {
    for (let i = palabra.indexOf(desde); i !== -1; i = palabra.indexOf(desde, i + 1))
      if (condicion(i)) salida.add(palabra.slice(0, i) + hasta + palabra.slice(i + desde.length));
  };
  cambia("v", "b");
  cambia("b", "v");
  cambia("ll", "y");
  cambia("y", "ll", (i) => vocal(palabra[i + 1]));
  cambia("y", "i", (i) => i > 0);
  cambia("i", "y", (i) => vocal(palabra[i - 1]));
  cambia("z", "s");
  cambia("s", "z", (i) => i < palabra.length - 1);
  cambia("c", "s", (i) => antesDeEI(i, 1));
  cambia("s", "c", (i) => antesDeEI(i, 1));
  cambia("z", "c", (i) => antesDeEI(i, 1));
  cambia("h", "", (i) => palabra[i - 1] !== "c");
  return salida;
}

/** Un solo cambio por palabra: encadenar dos cambios produce palabras que nadie escribe ("uioa" por "ulloa"). */
function variantesDe(palabra) {
  return [...vecinos(palabra)]
    .filter((v) => v !== palabra && v.length >= 3)
    .sort()
    .slice(0, MAXIMO_VARIANTES_POR_PALABRA);
}

/** Una frase con cada palabra distintiva reemplazada, de a una, por sus variantes de ortografía. */
function conFaltasDeOrtografia(frase, esDistintiva) {
  const palabras = frase.split(" ");
  return palabras.flatMap((palabra, i) =>
    esDistintiva(palabra) ? variantesDe(palabra).map((v) => [...palabras.slice(0, i), v, ...palabras.slice(i + 1)].join(" ")) : [],
  );
}

function crearDerivador(reglas, zonas) {
  const comunes = new Set(reglas.palabrasComunes);
  const soloConArticulo = new Set(reglas.soloConArticulo);
  const palabrasDeZona = new Set(zonas.flatMap((zona) => palabrasDe(zona)));
  const zonasDeUnaPalabra = new Set(zonas.filter((zona) => palabrasDe(zona).length === 1).map((zona) => palabrasDe(zona)[0]));
  const esDistintiva = (palabra) => palabra.length >= MINIMO_LETRAS_DISTINTIVA && !comunes.has(palabra);
  const todasComunes = (frase) => palabrasDe(frase).every((palabra) => comunes.has(palabra));
  const soloZona = (frase) => palabrasDe(frase).filter((palabra) => !comunes.has(palabra)).every((palabra) => palabrasDeZona.has(palabra));

  /** Núcleo del nombre: sin "Hospital Nacional de ..." delante ni "de <zona>" detrás ("José Agurto Tello de Chosica"). */
  function nucleoDe(nombre) {
    const palabras = palabrasDe(nombre);
    let inicio = 0;
    while (inicio < palabras.length - 1 && INICIALES_GENERICAS.has(palabras[inicio])) inicio++;
    let nucleo = palabras.slice(inicio);
    if (nucleo.length >= 3 && nucleo.at(-2) === "de" && zonasDeUnaPalabra.has(nucleo.at(-1))) nucleo = nucleo.slice(0, -2);
    return nucleo;
  }

  /** Nombre completo, últimas dos palabras y última palabra del núcleo (apellidos: "arzobispo loayza", "loayza"). */
  function basesDe(nucleo) {
    const bases = new Set();
    for (const k of [nucleo.length, 2, 1]) {
      const base = nucleo.slice(-k);
      const esCompleta = k === nucleo.length;
      // Una parte del nombre que empieza con palabra común ("este vitarte", "de mayo") no identifica: solo vale el nombre completo.
      if (base.length === k && !PARTICULAS.has(base[0]) && (esCompleta || !comunes.has(base[0]))) bases.add(base.join(" "));
    }
    return [...bases];
  }

  function formasSueltas(base) {
    if (soloConArticulo.has(base)) return ARTICULOS.map((articulo) => `${articulo} ${base}`);
    if (todasComunes(base) || soloZona(base)) return [];
    if (!base.includes(" ") && !esDistintiva(base)) return [];
    return [base];
  }

  function derivar({ nombre, tipo, codigo, siglaNormalizada }) {
    const formas = new Set();
    // La sigla solo pierde la letra doble ("FISSAL" -> "fisal"): sus faltas de ortografía no se inventan.
    const sigla = siglaNormalizada
      ?.split(" ")
      .map((palabra) => (palabra.length >= 4 ? palabra.replace(/(.)\1/g, "$1") : palabra))
      .join(" ");
    if (TIPOS_QUE_SE_DERIVAN.has(tipo) && !reglas.omitirDerivacion.includes(codigo)) {
      const prefijo = PREFIJO_POR_TIPO[tipo];
      const conNacional = palabrasDe(nombre).includes("nacional");
      for (const base of basesDe(nucleoDe(nombre))) {
        for (const forma of formasSueltas(base)) formas.add(forma);
        const unaPalabra = !base.includes(" ");
        if (unaPalabra && ((comunes.has(base) && tipo !== "INSTITUTO") || base.length < MINIMO_LETRAS_DISTINTIVA)) continue;
        formas.add(`${prefijo} ${base}`);
        formas.add(`${prefijo} de ${base}`);
        if (conNacional) formas.add(`${prefijo} nacional ${base}`);
      }
    }
    const conVariantes = [...formas].flatMap((forma) => [forma, ...conFaltasDeOrtografia(forma, esDistintiva)]);
    return [...new Set([...(sigla ? [sigla] : []), ...conVariantes])].filter((forma) => forma.length >= 4);
  }
  return derivar;
}

const contiene = (frase, subfrase) => ` ${frase} `.includes(` ${subfrase} `);

const nota = readFileSync(NOTA, "utf8");
const fechaLectura = /Leído el \*\*(\d{4}-\d{2}-\d{2})\*\*/.exec(nota)?.[1] ?? "fecha desconocida";
const manual = JSON.parse(readFileSync(ALIAS, "utf8"));
const ubicacionesManuales = JSON.parse(readFileSync(UBICACIONES, "utf8"));
const excluidas = new Set(Object.keys(manual.excluirSiglas).filter((clave) => clave !== "_comentario"));
const derivar = crearDerivador(
  manual.derivacion,
  ubicacionesManuales.zonas.map(({ zona }) => zona),
);

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
    siglaNormalizada: excluidas.has(sigla) ? null : normalizar(siglaLimpia(sigla)),
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
  if (d?.entidadDestinoCodigo && !codigos.has(d.entidadDestinoCodigo) && !DESTINOS_ESPECIALES.has(d.entidadDestinoCodigo))
    falla(`el destino de ${codigo} apunta a "${d.entidadDestinoCodigo}", que no está en el catálogo ni es un destino especial`);

// Alias derivados: se descartan los que nombran a dos entidades, los que son nombre o alias a mano de otra y los que quedan
// contenidos en un alias de otra (el filtro no sabría cuál elegir). Lo descartado queda documentado en alias-ambiguos.json.
const derivadosPorEntidad = new Map(entidades.map((e) => [e.codigo, derivar(e)]));
const aspirantes = new Map();
for (const [codigo, formas] of derivadosPorEntidad)
  for (const forma of formas) {
    if (duenos.get(forma) === codigo) continue;
    aspirantes.set(forma, new Set([...(aspirantes.get(forma) ?? []), codigo]));
  }
const ambiguos = {};
const descartar = (forma, motivo, entidadesInvolucradas) => {
  ambiguos[forma] = { motivo, entidades: [...new Set(entidadesInvolucradas)].sort() };
  aspirantes.delete(forma);
};
for (const [forma, duenosDerivados] of [...aspirantes]) {
  const dueno = duenos.get(forma);
  if (dueno) descartar(forma, "es nombre o alias escrito a mano de otra entidad", [...duenosDerivados, dueno]);
  else if (duenosDerivados.size > 1) descartar(forma, "la derivan varias entidades", duenosDerivados);
}
const formasDe = (codigo) => [
  ...[...duenos].filter(([, dueno]) => dueno === codigo).map(([forma]) => forma),
  ...[...aspirantes].filter(([, d]) => d.has(codigo)).map(([forma]) => forma),
];
const formasPorEntidad = new Map(entidades.map(({ codigo }) => [codigo, formasDe(codigo)]));
for (const [forma, duenosDerivados] of [...aspirantes]) {
  const [codigo] = [...duenosDerivados];
  const contenedor = entidades.find(
    (otra) => otra.codigo !== codigo && formasPorEntidad.get(otra.codigo).some((otraForma) => otraForma !== forma && contiene(otraForma, forma)),
  );
  if (contenedor) descartar(forma, `queda contenida en un alias de ${contenedor.codigo}`, [codigo, contenedor.codigo]);
}
for (const entidad of entidades)
  entidad.aliasDerivados = [...aspirantes].filter(([, d]) => d.has(entidad.codigo)).map(([forma]) => forma).sort();

const ambiguosConocidos = Object.fromEntries(Object.entries(manual.ambiguosConocidos).filter(([clave]) => clave !== "_comentario"));
for (const forma of Object.keys(ambiguosConocidos))
  for (const { codigo } of entidades)
    if (formasDe(codigo).includes(normalizar(forma))) falla(`"${forma}" es ambigua a propósito pero ya es alias de ${codigo}`);

const ubicaciones = ubicacionesManuales.zonas.map(({ zona, entidad, ambiguaConEstablecimiento = false }) => {
  if (!codigos.has(entidad)) falla(`la zona "${zona}" apunta a "${entidad}", que no está en el catálogo`);
  return { zona, codigoEntidad: entidad, ambiguaConEstablecimiento };
});
const zonasNormalizadas = ubicaciones.map(({ zona }) => normalizar(zona));
if (new Set(zonasNormalizadas).size !== zonasNormalizadas.length) falla("hay zonas repetidas en ubicaciones-entidades.json");

const literal = (valor) => JSON.stringify(valor);
const entidadComoTs = ({ codigo, nombre, tipo, alias, aliasDerivados, titular, destinoSiTitular: destino, contactos, huecos }) => `{
  codigo: ${literal(codigo)},
  nombre: ${literal(nombre)},
  tipo: TipoEntidad.${tipo},
  alias: ${literal(alias)},
  aliasDerivados: ${literal(aliasDerivados)},
  titular: ${literal(titular)},
  destinoSiTitular: ${literal(destino)},
  contactos: ${literal(contactos)},
  huecos: [${huecos.map((hueco) => `HuecoCatalogo.${hueco}`).join(", ")}],
}`;

const codigoTs = `// Generado por ia-poc/scripts/generar-catalogo.mjs; no editar a mano.
// Fuente: nota "Catálogo de entidades y titulares - Denuncias de corrupción" (destino de la denuncia contra el titular y
// directorios de gob.pe leídos el ${fechaLectura}) y ia-poc/datos/alias-entidades.json.
// \`alias\`: sigla y nombres cortos escritos a mano. \`aliasDerivados\`: variantes generadas del nombre oficial y la sigla (sin
// "Hospital"/"Nacional"/"de", con artículo, con faltas de ortografía frecuentes); los ambiguos están en ia-poc/datos/alias-ambiguos.json.
// Los nombres de los titulares rotan: solo se comparan como señal informativa, nunca deciden.
import { HuecoCatalogo, TipoEntidad } from "@/enums/filtro-corrupcion.enum.js";
import type { EntidadCatalogo } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

export const CATALOGO_ENTIDADES: readonly EntidadCatalogo[] = [
${entidades.map(entidadComoTs).join(",\n")},
];
`;

const ubicacionesTs = `// Generado por ia-poc/scripts/generar-catalogo.mjs desde ia-poc/datos/ubicaciones-entidades.json; no editar a mano.
// Zonas asociadas a una entidad. Es APROXIMADO (distrito donde queda el establecimiento): la ubicación suma poco y nunca decide.
import type { UbicacionEntidad } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

export const UBICACIONES_ENTIDADES: readonly UbicacionEntidad[] = ${literal(ubicaciones)};
`;

const configuracion = (await resolveConfig(SALIDA.pathname)) ?? {};
writeFileSync(SALIDA, await format(codigoTs, { ...configuracion, parser: "typescript", printWidth: 140 }));
writeFileSync(SALIDA_UBICACIONES, await format(ubicacionesTs, { ...configuracion, parser: "typescript", printWidth: 140 }));
writeFileSync(
  SALIDA_AMBIGUOS,
  JSON.stringify(
    {
      _comentario:
        "Generado por ia-poc/scripts/generar-catalogo.mjs. Alias derivados que se descartaron porque el filtro no sabría cuál entidad elegir; no se elige ninguna.",
      descartadosPorElGenerador: Object.fromEntries(Object.entries(ambiguos).sort(([a], [b]) => a.localeCompare(b))),
      ambiguosPorDiseno: ambiguosConocidos,
    },
    null,
    2,
  ) + "\n",
);

const sinDestino = entidades.filter(({ destinoSiTitular: d }) => d === null).map(({ codigo }) => codigo);
console.log(`Con destino si la denuncia es contra el titular: ${entidades.length - sinDestino.length}; sin destino: ${sinDestino.join(", ") || "ninguna"}`);
const conHuecos = entidades.filter(({ huecos }) => huecos.length > 0);
console.log(`${entidades.length} entidades escritas en src/services/filtro-corrupcion/catalogo-entidades.data.ts`);
console.log(`Alias derivados: ${entidades.reduce((suma, e) => suma + e.aliasDerivados.length, 0)}; descartados por ambiguos: ${Object.keys(ambiguos).length}`);
console.log(`${ubicaciones.length} zonas escritas en src/services/filtro-corrupcion/ubicaciones-entidades.data.ts`);
console.log(`Alias manuales mezclados (${aliasManualesUsados.length}): ${aliasManualesUsados.join(" | ")}`);
console.log(`Con huecos (${conHuecos.length}):`);
for (const { codigo, huecos } of conHuecos) console.log(`  ${codigo}: ${huecos.join(", ")}`);
