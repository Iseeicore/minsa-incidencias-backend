import type {
  FuenteNorma,
  GrupoCita,
  TipoFragmentoNorma,
} from "@/enums/normas.enum.js";

/** Un fragmento de norma con su texto literal (sin parafrasear). */
export interface FragmentoNorma {
  id: string;
  fuente: FuenteNorma;
  /** Dónde está en el documento, por ejemplo «Directiva N° 002-2023-PCM-SIP, Anexo C, III, b)». */
  referencia: string;
  titulo: string;
  tipo: TipoFragmentoNorma;
  /** Texto tal cual está en el documento, con sus erratas. */
  texto: string;
  /** `false` si el código nunca lo cita solo (cohecho activo: lo comete quien paga). */
  citaAutomatica: boolean;
  motivoSinCita?: string;
}

export interface FuenteDeNormas {
  id: FuenteNorma;
  nombre: string;
  archivo: string;
}

export interface DatosNormas {
  version: string;
  aviso: string;
  /** `false`: el Anexo C se transcribió a ojo desde imágenes y no se cotejó con el original. */
  transcripcionAnexoCCotejada: boolean;
  avisoTranscripcion: string;
  /** Comparación del Anexo C con un segundo texto que pegó el usuario. No reemplaza el cotejo con el documento oficial. */
  cotejoConTextoDelUsuario: {
    fecha: string;
    comparados: number;
    coincidenLiteralmente: number;
    difierenSoloEnMayusculas: string[];
    nota: string;
  };
  fuentes: FuenteDeNormas[];
  fragmentos: FragmentoNorma[];
}

/** Una cita de la norma en el paquete del análisis. */
export interface CitaNorma {
  fragmentoId: string;
  fuente: FuenteNorma;
  referencia: string;
  titulo: string;
  tipo: TipoFragmentoNorma;
  texto: string;
  grupo: GrupoCita;
  /** Frases de las señales de las reglas que motivaron la cita (ya normalizadas). Vacío en las citas de procedimiento. */
  senalesQueLaMotivan: string[];
  /** Por qué se cita (en español, hecho por una plantilla). */
  motivo: string;
}

/** La trazabilidad del análisis con la norma. La hace el código; el modelo no escribe citas. */
export interface TrazabilidadNormas {
  version: string;
  /** Siempre «Referencia orientativa; la califica OTRANS.». */
  etiqueta: string;
  /** Supuestos del Anexo C que se parecen a las señales (solo si se propone corrupción). */
  supuestos: CitaNorma[];
  /** Textos del procedimiento de OTRANS que respaldan la propuesta (corrupción, queja o reclamo, faltantes). */
  procedimiento: CitaNorma[];
  /** `true` si se propone corrupción y ningún supuesto coincide con las señales: lo dice en vez de inventar uno. */
  sinSupuestoIdentificado: boolean;
  /** Mientras sea `false`, el Anexo C no se ha comparado con el documento oficial. */
  transcripcionAnexoCCotejada: boolean;
}
