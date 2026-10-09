import type {
  InformacionFaltanteIa,
  MotivoFalloIa,
  VarianteIa,
} from "@/enums/analisis-ia.enum.js";
import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import type { MotivoDeEscritura } from "@/enums/clasificador.enum.js";
import type { PaqueteAnalisis } from "@/services/analisis-ia/analisis-ia.types.js";
import {
  construirSenalesDeAnalisis,
  type SenalesDeAnalisis,
} from "@/services/analisis-ia/senales-analisis.js";
import type { DecisionDeEscritura } from "@/services/clasificador/regla-de-escritura.js";

/** Por qué se escribió lo que se escribió, y lo que el análisis dijo (sin el texto del ciudadano). */
export interface DecisionGuardada {
  categoriaEscrita: CategoriaIncidencia;
  motivo: MotivoDeEscritura;
  /** Lo que propuso el análisis antes de la regla de escritura. */
  propuestaDelAnalisis: CategoriaIncidencia;
  confianzaDelAnalisis: number;
  confianzaEscrita: number;
  /** Acoso contra un cargo mayor: solo marcado, la base no lo enruta. */
  escalarAOtrans: boolean;
  requiereRevisionHumana: boolean;
  revisionOtrans: boolean;
  puntajeReglas: number;
  puntajeTotal: number;
  pesoIa: number | null;
}

export interface ModeloGuardado {
  variante: VarianteIa | null;
  /** `true` si el modelo falló o no se consultó y valieron solo las reglas. */
  degradado: boolean;
  motivoDegradado: MotivoFalloIa | null;
  categoriaDelModelo: CategoriaIncidencia | null;
  posibleCorrupcion: boolean | null;
}

/**
 * Contenido de `chatbot.incidencia_analisis.senales` que escribe el clasificador: las señales, los faltantes, la ficha de derivación y
 * las citas de la norma (`SenalesDeAnalisis`), más la explicación por plantilla, la decisión de escritura y lo que dijo el modelo.
 * Nunca lleva el texto del ciudadano ni el texto literal de las normas (se recupera de la versión de normas).
 */
export interface SenalesGuardadas extends SenalesDeAnalisis {
  /** Explicación por plantilla (puntaje, señales, entidad, titular, categoría del modelo y por qué se propone OTRANS o no). */
  explicacion: string | null;
  informacionFaltante: InformacionFaltanteIa[];
  decision: DecisionGuardada;
  modelo: ModeloGuardado;
}

export function construirSenalesGuardadas(
  paquete: PaqueteAnalisis,
  decision: DecisionDeEscritura,
): SenalesGuardadas {
  return {
    ...construirSenalesDeAnalisis(paquete),
    explicacion: paquete.explicacion,
    informacionFaltante: paquete.informacionFaltante,
    decision: {
      categoriaEscrita: decision.categoria,
      motivo: decision.motivo,
      propuestaDelAnalisis: decision.propuestaDelAnalisis,
      confianzaDelAnalisis: paquete.confianza,
      confianzaEscrita: decision.confianza,
      escalarAOtrans: decision.escalarAOtrans,
      requiereRevisionHumana: paquete.requiereRevisionHumana,
      revisionOtrans: paquete.revisionOtrans,
      puntajeReglas: paquete.combinacion.puntajeReglas,
      puntajeTotal: paquete.combinacion.puntajeTotal,
      pesoIa: paquete.pesoIa,
    },
    modelo: {
      variante: paquete.variante,
      degradado: paquete.degradado,
      motivoDegradado: paquete.motivoDegradado,
      categoriaDelModelo: paquete.salidaModelo?.categoria ?? null,
      posibleCorrupcion: paquete.salidaModelo?.posible_corrupcion ?? null,
    },
  };
}
