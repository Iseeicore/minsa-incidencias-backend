import {
  CANDIDATOS_MAXIMOS_POR_CONSULTA,
  CASOS_SIMILARES_MAXIMOS,
  CATEGORIA_POR_ID_DE_CATALOGO,
  RELACION_CASOS_REVISADOS,
  SIMILITUD_CASI_DUPLICADO,
  SIMILITUD_MINIMA_CASO,
} from "@/constants/casos-similares.js";
import type { DbExecutor } from "@/database/database.js";
import type {
  CasoSimilar,
  RecuperadorCasos,
  ResultadoRecuperacion,
} from "@/services/analisis-ia/casos/casos.types.js";

/** Solo nombres de relación sencillos (`esquema.tabla`): la relación va dentro del SQL, no como parámetro. */
const RELACION_VALIDA = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

export interface OpcionesRecuperacion {
  /** Tabla o tabla temporal de la que se leen los casos. Por defecto `ia.entrenamiento_categoria`. */
  relacion?: string;
  maximo?: number;
  similitudMinima?: number;
  similitudCasiDuplicado?: number;
}

/**
 * Consulta con `pg_trgm`: la similitud de trigramas entre el texto (sin tildes) y cada caso apto, de mayor a menor. Solo SELECT.
 * `unaccent` no es inmutable, así que no hay índice posible sobre esta expresión: con cientos de casos basta un recorrido; con volumen
 * real habrá que envolverla en una función inmutable y crear un índice GIN.
 */
export function consultaCasosSimilares(relacion: string): string {
  if (!RELACION_VALIDA.test(relacion))
    throw new Error(
      `Relación no válida para la recuperación de casos: ${relacion}`,
    );
  return `SELECT id, categoria_final_id, texto, similitud FROM (
  SELECT id::text AS id, categoria_final_id, texto_entrenamiento AS texto,
         similarity(unaccent(texto_entrenamiento), unaccent($1)) AS similitud
  FROM ${relacion}
  WHERE apto_entrenamiento
) AS candidatos
WHERE similitud >= $2
ORDER BY similitud DESC, id
LIMIT $3`;
}

export interface FilaDeCaso {
  id: string;
  categoria_final_id: number;
  texto: string;
  similitud: number;
}

const redondear4 = (valor: number): number =>
  Math.round(valor * 10_000) / 10_000;

/**
 * Deja los mejores casos: descarta los casi duplicados (similitud de `similitudCasiDuplicado` o más), cuenta cuántos descartó y se queda
 * con `maximo`. Función pura sobre filas ya ordenadas de mayor a menor similitud.
 */
export function seleccionarCasos(
  filas: readonly FilaDeCaso[],
  opciones: Pick<
    OpcionesRecuperacion,
    "maximo" | "similitudCasiDuplicado"
  > = {},
): ResultadoRecuperacion {
  const maximo = opciones.maximo ?? CASOS_SIMILARES_MAXIMOS;
  const tope = opciones.similitudCasiDuplicado ?? SIMILITUD_CASI_DUPLICADO;
  const casos: CasoSimilar[] = [];
  let casiDuplicadosDescartados = 0;
  for (const fila of filas) {
    if (fila.similitud >= tope) {
      casiDuplicadosDescartados++;
      continue;
    }
    const categoria = CATEGORIA_POR_ID_DE_CATALOGO[fila.categoria_final_id];
    if (categoria === undefined || casos.length >= maximo) continue;
    casos.push({
      id: fila.id,
      categoria,
      similitud: redondear4(fila.similitud),
      texto: fila.texto,
    });
  }
  return { casos, casiDuplicadosDescartados };
}

const SIN_CASOS: ResultadoRecuperacion = {
  casos: [],
  casiDuplicadosDescartados: 0,
};

/**
 * Recuperador de casos revisados con `pg_trgm`. Nunca lanza: si la base falla o el texto está vacío devuelve «sin casos» y el análisis
 * sigue sin ejemplos (un caso es una pista, no un requisito). No guarda ni registra el texto.
 */
export function crearRecuperadorPgTrgm(
  base: DbExecutor,
  opciones: OpcionesRecuperacion = {},
): RecuperadorCasos {
  const sql = consultaCasosSimilares(
    opciones.relacion ?? RELACION_CASOS_REVISADOS,
  );
  const minima = opciones.similitudMinima ?? SIMILITUD_MINIMA_CASO;
  return async (texto) => {
    if (texto.trim() === "") return SIN_CASOS;
    try {
      const filas = await base.query<FilaDeCaso & Record<string, unknown>>(
        sql,
        [texto, minima, CANDIDATOS_MAXIMOS_POR_CONSULTA],
      );
      return seleccionarCasos(filas, opciones);
    } catch {
      return SIN_CASOS;
    }
  };
}
