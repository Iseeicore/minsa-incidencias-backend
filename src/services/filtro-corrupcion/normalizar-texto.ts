import { PALABRA_DE_MONTO } from "@/constants/filtro-corrupcion.js";

const MARCAS_DIACRITICAS = /\p{M}/gu;
const NO_ALFANUMERICO = /[^\p{L}\p{N}]+/gu;
const SOLO_DIGITOS = /^\d+$/;
const PALABRAS_DE_MONTO = new Set(["soles", "sol", "dolares", "dolar"]);

/** Minúsculas, sin tildes (NFD), sin signos y con espacios simples. Es lo primero que se hace con cualquier texto. */
export function normalizarTexto(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(MARCAS_DIACRITICAS, "").replace(NO_ALFANUMERICO, " ").trim();
}

export function tokenizar(texto: string): string[] {
  const normalizado = normalizarTexto(texto);
  return normalizado === "" ? [] : normalizado.split(" ");
}

/**
 * Como `quitarMontos`, pero deja la palabra `monto` donde había un importe en dinero ("50 soles", "s/ 20"): así "me pidió 50 soles"
 * conserva su objeto. Los números sueltos que no son dinero ("4 días") se quitan. Las frases del léxico que no mencionan el monto
 * lo saltan al buscar (ver `calzarDesde`), de modo que "pagué 20 soles en caja" sigue siendo "pagué en caja".
 */
export function marcarMontos(palabras: readonly string[]): string[] {
  const resultado: string[] = [];
  palabras.forEach((palabra, i) => {
    const anterior = palabras[i - 1];
    const siguiente = palabras[i + 1];
    const esNumero = SOLO_DIGITOS.test(palabra);
    const anteriorEsNumero = anterior !== undefined && SOLO_DIGITOS.test(anterior);
    const siguienteEsNumero = siguiente !== undefined && SOLO_DIGITOS.test(siguiente);
    if (esNumero) {
      const esDinero = (siguiente !== undefined && PALABRAS_DE_MONTO.has(siguiente)) || anterior === "s";
      if (esDinero) resultado.push(PALABRA_DE_MONTO);
      return;
    }
    if (PALABRAS_DE_MONTO.has(palabra) && anteriorEsNumero) return;
    if (palabra === "s" && siguienteEsNumero) return;
    resultado.push(palabra);
  });
  return resultado;
}

/**
 * Quita los montos ("50 soles", "s/ 20") para que no corten una frase del léxico: "pagué 20 soles en caja" debe seguir
 * siendo "pague en caja". Las palabras sueltas "s" y "sol" solo se quitan al lado de un número.
 */
export function quitarMontos(palabras: readonly string[]): string[] {
  const resultado: string[] = [];
  palabras.forEach((palabra, i) => {
    const anterior = palabras[i - 1];
    const siguiente = palabras[i + 1];
    const esNumero = SOLO_DIGITOS.test(palabra);
    const sigueNumero = siguiente !== undefined && SOLO_DIGITOS.test(siguiente);
    const vaDetrasDeNumero = anterior !== undefined && SOLO_DIGITOS.test(anterior);
    if (esNumero) return;
    if (PALABRAS_DE_MONTO.has(palabra) && vaDetrasDeNumero) return;
    if (palabra === "s" && sigueNumero) return;
    resultado.push(palabra);
  });
  return resultado;
}
