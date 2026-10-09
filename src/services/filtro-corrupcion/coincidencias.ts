import { HUECO_MAXIMO_PALABRAS, MARCA_DE_HUECO, PALABRA_DE_MONTO } from "@/constants/filtro-corrupcion.js";
import { CLASES, CLASES_POR_PALABRA, PREFIJO_DE_CLASE } from "@/services/filtro-corrupcion/clases-lexico.js";
import { normalizarTexto } from "@/services/filtro-corrupcion/normalizar-texto.js";

/**
 * Una frase del léxico ya normalizada, como secuencia de palabras. `~` es un hueco de hasta 3 palabras cualesquiera y
 * `@clase` calza con cualquier palabra de esa clase (ver `clases-lexico.ts`).
 */
export type Patron = readonly string[];

/** Lo que toda entrada del léxico aporta: sus puntos y la plantilla de la que salió (todas sus variantes cuentan una vez). */
export interface EntradaPonderada {
  peso: number;
  grupo: string;
  /**
   * Frases de una misma familia que se pisan en el texto cuentan una sola vez (la de más puntos): "me cobraron 50 soles" y
   * "me cobraron ~ para darme la cita" son la misma acusación, no dos.
   */
  familia?: string;
}

export interface Coincidencia<T extends EntradaPonderada> {
  entrada: T;
  patron: Patron;
  /** Posición de la primera palabra del texto que coincide. */
  inicio: number;
  /** Posición siguiente a la última palabra que coincide (exclusiva). */
  fin: number;
}

const GRUPO_DE_VARIANTES = /\{([^{}]*)\}/;

/**
 * Expande las variantes `{a|b}` de una plantilla del léxico en todas las frases que describe:
 * `"me {pidio|pidieron} plata"` da `["me pidio plata", "me pidieron plata"]`. Una variante vacía (`{su|}`) la hace opcional.
 */
export function expandirPlantilla(plantilla: string): string[] {
  const grupo = GRUPO_DE_VARIANTES.exec(plantilla);
  if (!grupo) return [plantilla];
  const [coincidencia, opciones = ""] = grupo;
  return opciones.split("|").flatMap((opcion) => expandirPlantilla(plantilla.replace(coincidencia, opcion)));
}

const esClase = (elemento: string): boolean => elemento.startsWith(PREFIJO_DE_CLASE);

function elementoCompilado(palabra: string): string {
  if (palabra === MARCA_DE_HUECO) return palabra;
  if (!esClase(palabra)) return normalizarTexto(palabra);
  if (!CLASES.has(palabra.slice(PREFIJO_DE_CLASE.length))) throw new Error(`Clase de palabras desconocida en el léxico: ${palabra}`);
  return palabra;
}

/** Plantilla del léxico a patrones normalizados (minúsculas, sin tildes ni signos), listos para buscar. */
export function compilarPlantilla(plantilla: string): Patron[] {
  return expandirPlantilla(plantilla).map((frase) =>
    frase
      .split(/\s+/)
      .filter((palabra) => palabra !== "")
      .map(elementoCompilado),
  );
}

function calzaElemento(elemento: string, palabra: string | undefined): boolean {
  if (palabra === undefined) return false;
  if (!esClase(elemento)) return palabra === elemento;
  return CLASES.get(elemento.slice(PREFIJO_DE_CLASE.length))?.has(palabra) ?? false;
}

/** Un monto en medio de una frase no la corta, salvo que la frase lo nombre ("me cobraron 50 soles sin recibo" calza con "cobraron sin recibo"). */
function saltarMontos(palabras: readonly string[], desde: number, elemento: string): number {
  let posicion = desde;
  while (elemento !== PALABRA_DE_MONTO && palabras[posicion] === PALABRA_DE_MONTO) posicion++;
  return posicion;
}

/** Dónde termina el patrón si calza empezando en `desde`, o `null`. Con huecos prueba del más corto al más largo. */
function calzarDesde(patron: Patron, palabras: readonly string[], posicionPatron: number, desde: number): number | null {
  if (posicionPatron === patron.length) return desde;
  if (patron[posicionPatron] === MARCA_DE_HUECO) {
    for (let hueco = 0; hueco <= HUECO_MAXIMO_PALABRAS; hueco++) {
      const fin = calzarDesde(patron, palabras, posicionPatron + 1, desde + hueco);
      if (fin !== null) return fin;
    }
    return null;
  }
  const elemento = patron[posicionPatron] ?? "";
  const posicion = posicionPatron === 0 ? desde : saltarMontos(palabras, desde, elemento);
  if (!calzaElemento(elemento, palabras[posicion])) return null;
  return calzarDesde(patron, palabras, posicionPatron + 1, posicion + 1);
}

export type IndicePorPrimeraPalabra<T extends EntradaPonderada> = ReadonlyMap<string, readonly { patron: Patron; entrada: T }[]>;

/** Agrupa los patrones por su primera palabra (o por su clase, si empiezan con `@clase`) para no probar todo el léxico en cada posición del texto. */
export function crearIndice<T extends EntradaPonderada>(entradas: readonly { patron: Patron; entrada: T }[]): IndicePorPrimeraPalabra<T> {
  const indice = new Map<string, { patron: Patron; entrada: T }[]>();
  for (const item of entradas) {
    const primera = item.patron[0];
    if (primera === undefined || primera === MARCA_DE_HUECO) continue;
    const lista = indice.get(primera) ?? [];
    lista.push(item);
    indice.set(primera, lista);
  }
  return indice;
}

export function buscarCoincidencias<T extends EntradaPonderada>(
  palabras: readonly string[],
  indice: IndicePorPrimeraPalabra<T>,
): Coincidencia<T>[] {
  const resultado: Coincidencia<T>[] = [];
  palabras.forEach((palabra, inicio) => {
    const candidatos = [
      ...(indice.get(palabra) ?? []),
      ...(CLASES_POR_PALABRA.get(palabra) ?? []).flatMap((clase) => indice.get(`${PREFIJO_DE_CLASE}${clase}`) ?? []),
    ];
    for (const { patron, entrada } of candidatos) {
      const fin = calzarDesde(patron, palabras, 0, inicio);
      if (fin !== null) resultado.push({ entrada, patron, inicio, fin });
    }
  });
  return resultado;
}

const literales = (patron: Patron): ReadonlySet<string> => new Set(patron.filter((palabra) => palabra !== MARCA_DE_HUECO));

const estaDentro = (interna: { inicio: number; fin: number }, externa: { inicio: number; fin: number }): boolean =>
  externa.inicio <= interna.inicio && interna.fin <= externa.fin;

/**
 * Dos coincidencias chocan si se pisan sin que una contenga a la otra, o si una está dentro de la otra y todas sus
 * palabras son de la frase mayor (es la misma idea dicha en corto: "venden las medicinas" dentro de "venden las
 * medicinas del sis"). Una frase dentro de otra con palabras propias ("sin recibo" dentro de "me cobraron ~ para
 * darme la cita") es otra señal y no choca.
 */
function chocan<T extends EntradaPonderada>(a: Coincidencia<T>, b: Coincidencia<T>): boolean {
  const sePisan = a.inicio < b.fin && b.inicio < a.fin;
  if (!sePisan) return false;
  if (a.entrada.familia !== undefined && a.entrada.familia === b.entrada.familia) return true;
  const aDentroDeB = estaDentro(a, b);
  const bDentroDeA = estaDentro(b, a);
  if (!aDentroDeB && !bDentroDeA) return true;
  const literalesA = literales(a.patron);
  const literalesB = literales(b.patron);
  if (aDentroDeB && [...literalesA].every((palabra) => literalesB.has(palabra))) return true;
  return bDentroDeA && [...literalesB].every((palabra) => literalesA.has(palabra));
}

/**
 * Deja una sola vez cada frase (la primera vez que aparece) y descarta las que chocan con otra de más prioridad.
 * Prioridad: más puntos en valor absoluto, luego la frase que abarca más, luego la que aparece antes.
 */
export function resolverChoques<T extends EntradaPonderada>(coincidencias: readonly Coincidencia<T>[]): Coincidencia<T>[] {
  const vistas = new Set<string>();
  const unicas = coincidencias.filter((c) => {
    const clave = c.entrada.grupo;
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
  const porPrioridad = [...unicas].sort(
    (a, b) => Math.abs(b.entrada.peso) - Math.abs(a.entrada.peso) || b.fin - b.inicio - (a.fin - a.inicio) || a.inicio - b.inicio,
  );
  const aceptadas: Coincidencia<T>[] = [];
  for (const candidata of porPrioridad) {
    if (!aceptadas.some((aceptada) => chocan(candidata, aceptada))) aceptadas.push(candidata);
  }
  return aceptadas.sort((a, b) => a.inicio - b.inicio);
}
