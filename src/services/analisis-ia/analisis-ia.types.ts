import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import type {
  FormatoSalidaIa,
  InformacionFaltanteIa,
  MotivoFalloIa,
  OrigenFundamento,
  VarianteIa,
} from "@/enums/analisis-ia.enum.js";
import type { SenalSensible } from "@/enums/filtro-corrupcion.enum.js";
import type { SalidaIa } from "@/services/analisis-ia/esquema-salida.js";
import type { TrazabilidadNormas } from "@/services/analisis-ia/normas/normas.types.js";
import type {
  ContextoEvaluacion,
  ReferenciaDerivacion,
  ResultadoCombinacion,
  ResultadoCorrupcion,
} from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

/** Lo que se le manda al modelo. El sistema es idéntico entre llamadas de la misma variante (caché del prefijo). */
export interface PeticionModelo {
  sistema: string;
  usuario: string;
  /** Qué debe escribir el modelo. Sin dato rige `COMPLETA` (V1 a V3). */
  formato?: FormatoSalidaIa;
}

/** Tiempos y tokens de una consulta (Ollama los informa en nanosegundos; aquí todo en milisegundos). Nunca llevan texto. */
export interface MetricasModelo {
  /** Cuántas llamadas se hicieron (1 o, con reintento, 2). */
  intentos: number;
  /** Tiempo real desde que empezó la consulta hasta que terminó, con los reintentos. */
  duracionMs: number;
  /** `total_duration` del último intento que respondió. */
  totalOllamaMs: number | null;
  cargaModeloMs: number | null;
  procesoPromptMs: number | null;
  generacionMs: number | null;
  tokensPrompt: number | null;
  tokensSalida: number | null;
}

export type ResultadoConsulta =
  | { ok: true; salida: SalidaIa; metricas: MetricasModelo }
  | { ok: false; motivo: MotivoFalloIa; metricas: MetricasModelo };

/** El modelo detrás de una interfaz: en producción es Ollama; en las pruebas, un simulado sin red. Nunca lanza. */
export interface ClienteModelo {
  consultar(peticion: PeticionModelo): Promise<ResultadoConsulta>;
}

/** Datos opcionales de la petición que el filtro no puede sacar del texto. */
export interface ContextoAnalisis extends ContextoEvaluacion {
  /** Nombre del establecimiento del QR; solo se muestra al modelo como contexto. */
  establecimiento?: string;
}

export interface OpcionesAnalisis {
  variante?: VarianteIa;
  cliente?: ClienteModelo;
  /** Piso del peso efectivo cuando el modelo marca `posible_corrupcion` (ver `PISO_PESO_POSIBLE_CORRUPCION_POR_DEFECTO`). */
  pisoPesoPosibleCorrupcion?: number | null;
}

/** Una pista que respalda la propuesta: la frase normalizada de las reglas, o la que el modelo copió del texto. */
export interface Fundamento {
  origen: OrigenFundamento;
  frase: string;
  tipo: string;
}

/** Paquete del análisis: una propuesta que una persona confirma o corrige. No decide el destino ni guarda nada. */
export interface PaqueteAnalisis {
  propuesta: CategoriaIncidencia;
  /** Porcentaje de 0 a 95: nunca 100. */
  confianza: number;
  /** Peso del modelo ya recortado (0 a 10); `null` si el modelo no se consultó o falló. */
  pesoIa: number | null;
  explicacion: string | null;
  fundamentos: Fundamento[];
  informacionFaltante: InformacionFaltanteIa[];
  /** La `referenciaDerivacion` del filtro (con `destinoSiTitular`); `null` si el filtro no propuso corrupción o no hay entidad. */
  fichaDerivacion: ReferenciaDerivacion | null;
  /** `true` si el modelo falló o no estuvo disponible: valen solo las reglas. */
  degradado: boolean;
  motivoDegradado: MotivoFalloIa | null;
  /** Corrupción propuesta: va a OTRANS. */
  requiereOtrans: boolean;
  /** OTRANS debe mirarlo (corrupción, o duda de las reglas sin modelo que la resuelva). */
  revisionOtrans: boolean;
  /** Una persona debe decidir: corrupción, discrepancia, duda o empate. */
  requiereRevisionHumana: boolean;
  /** Acoso contra un cargo mayor: lo marcan las reglas; hoy solo se marca, no se enruta. */
  escalarAOtrans: boolean;
  senalSensible: SenalSensible | null;
  /** `true` si queja y reclamo quedaron empatados y se propuso Reclamo. */
  empateQuejaReclamo: boolean;
  variante: VarianteIa | null;
  /**
   * Trazabilidad con la norma (Directiva N° 002-2023-PCM-SIP, Anexo C, y ayuda memoria de OTRANS), hecha por el código con las señales de
   * las reglas: el modelo no escribe citas. Referencia orientativa; la califica OTRANS.
   */
  trazabilidadNormas: TrazabilidadNormas;
  reglas: ResultadoCorrupcion;
  combinacion: ResultadoCombinacion;
  /** Lo que respondió el modelo, validado (completa o compacta); `null` si no se consultó o falló. */
  salidaModelo: SalidaIa | null;
  /**
   * `true` si el modelo respondió con la salida compacta (V2C): no entrega alternativas y por eso no se puede detectar el empate entre
   * queja y reclamo del modelo. Pérdida conocida; la propuesta sigue siendo de una persona.
   */
  sinDesempateQuejaReclamo: boolean;
  metricas: MetricasModelo | null;
}
