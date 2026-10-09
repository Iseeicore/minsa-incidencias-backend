import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";

/*
 * RAG de casos corregidos (fase 2, variante V2R). Parámetros iniciales fijados en la sección 25 del plan de PoC ANTES de medir; se pueden
 * ajustar como máximo dos veces, mirando solo desarrollo-v2.
 */

/** Cuántos casos parecidos se le muestran al modelo. */
export const CASOS_SIMILARES_MAXIMOS = 3;

/** Similitud de trigramas (`pg_trgm`, de 0 a 1) por debajo de la cual un caso no se considera parecido. */
export const SIMILITUD_MINIMA_CASO = 0.15;

/**
 * Un caso con esta similitud o más es casi un duplicado del mensaje que se evalúa: se descarta, para que el modelo no copie la respuesta
 * (y para no inflar las mediciones).
 */
export const SIMILITUD_CASI_DUPLICADO = 0.5;

/** Cuántos candidatos trae la consulta antes de descartar los casi duplicados y quedarse con los mejores. */
export const CANDIDATOS_MAXIMOS_POR_CONSULTA = 50;

/** Un ejemplo largo gasta tokens de entrada: se corta a esta cantidad de caracteres. */
export const CARACTERES_MAXIMOS_POR_CASO = 280;

/** Tabla de la que lee la recuperación en producción: las revisiones de una persona (`fue_corregida` o no) aptas para entrenar. */
export const RELACION_CASOS_REVISADOS = "ia.entrenamiento_categoria";

/** Ids de `catalogo.categoria_incidencia` (verificados en la base de pruebas). */
export const CATEGORIA_POR_ID_DE_CATALOGO: Readonly<
  Record<number, CategoriaIncidencia>
> = {
  1: CategoriaIncidencia.DENUNCIA_CORRUPCION,
  2: CategoriaIncidencia.QUEJA,
  3: CategoriaIncidencia.RECLAMO,
  4: CategoriaIncidencia.OTRO,
};
