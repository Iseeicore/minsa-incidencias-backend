import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";

/** Un caso que una persona ya revisó, parecido al mensaje que se analiza. */
export interface CasoSimilar {
  id: string;
  /** La categoría final que decidió la persona. */
  categoria: CategoriaIncidencia;
  /** Similitud de trigramas con el mensaje, de 0 a 1 (4 decimales). */
  similitud: number;
  /** Texto del caso: va al prompt, nunca a los registros ni a los informes. */
  texto: string;
}

/** Lo que queda en el paquete del análisis: sin el texto del caso. */
export interface CasoSimilarResumen {
  id: string;
  categoria: CategoriaIncidencia;
  similitud: number;
}

export interface ResultadoRecuperacion {
  casos: CasoSimilar[];
  /** Cuántos candidatos se descartaron por ser casi duplicados del mensaje (similitud de `SIMILITUD_CASI_DUPLICADO` o más). */
  casiDuplicadosDescartados: number;
}

/** Busca los casos revisados parecidos a un texto. Nunca debe lanzar: si falla, el análisis sigue sin ejemplos. */
export type RecuperadorCasos = (
  texto: string,
) => Promise<ResultadoRecuperacion>;
