import type { CategoriaApi } from "@/constants/incidencias.js";
import type { VarianteIa } from "@/enums/analisis-ia.enum.js";
import type { MotivoDeEscritura } from "@/enums/clasificador.enum.js";
import type { GrupoCita } from "@/enums/normas.enum.js";
import type { ReferenciaDerivacion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";
import type { SesionActual } from "@/services/auth.types.js";

export interface SenalDto {
  frase: string;
  tipo: string;
  peso: number;
}

/** Una cita de la norma con su texto literal, recuperado de la versión de normas guardada. */
export interface CitaNormaDto {
  fragmentoId: string;
  grupo: GrupoCita;
  referencia: string;
  titulo: string;
  /** Texto literal del documento; `null` si el fragmento ya no existe en las normas (cambió la versión). */
  texto: string | null;
  /** Frases de las señales de las reglas que motivaron la cita. */
  senalesQueLaMotivan: string[];
}

export interface RequisitoFaltanteDto {
  /** `hecho_detallado`, `autor_o_cargo`, `entidad_o_unidad` o `pruebas`. */
  codigo: string;
  referencia: string;
  texto: string;
}

/**
 * Lo que OTRANS y el administrador ven del análisis de la IA de un caso. **Nunca lo ve un establecimiento**: lleva el nombre que
 * escribió el ciudadano (una acusación sin comprobar) y las citas de la norma.
 */
export interface AnalisisIaDto {
  codigo: string;
  /** Categoría que escribió el clasificador (la que la base usó para enrutar). */
  categoriaIa: CategoriaApi | null;
  confianzaIa: number | null;
  versionClasificador: string | null;
  versionReglas: string;
  puntaje: number;
  /** Por qué se escribió esa categoría; `null` si el análisis lo escribió otro proceso. */
  motivoDeEscritura: MotivoDeEscritura | null;
  /** Lo que propuso el análisis antes de la regla de escritura (en la duda de corrupción es Reclamo). */
  propuestaDelAnalisis: CategoriaApi | null;
  /** Una persona de OTRANS debe mirarlo: corrupción o duda de corrupción. */
  requiereRevisionHumana: boolean;
  /** Acoso contra un cargo mayor: solo se marca; hoy no hay una vía que lo enrute a OTRANS. */
  escalarAOtrans: boolean;
  /** Explicación por plantilla, hecha por las reglas: no la escribe el modelo. */
  explicacion: string | null;
  senales: SenalDto[];
  /** Supuestos del Anexo C que se parecen a las señales. Referencia orientativa; la califica OTRANS. */
  supuestos: CitaNormaDto[];
  procedimiento: CitaNormaDto[];
  sinSupuestoIdentificado: boolean;
  /** «Referencia orientativa; la califica OTRANS.». */
  etiquetaNormas: string;
  versionNormas: string | null;
  /** `false` mientras el Anexo C no se haya comparado con el documento oficial de la PCM. */
  transcripcionAnexoCCotejada: boolean;
  requisitosFaltantes: RequisitoFaltanteDto[];
  fichaDerivacion: ReferenciaDerivacion | null;
  cargoMencionado: string | null;
  /** Nombre que escribió el ciudadano: acusación sin comprobar, solo informativa. */
  nombreMencionado: string | null;
  areaMencionada: { codigo: string; nombre: string } | null;
  modelo: {
    variante: VarianteIa | null;
    degradado: boolean;
    pesoIa: number | null;
  };
  fechaAnalisis: string;
}

export interface AnalisisIncidenciaServicio {
  obtener(sesion: SesionActual, codigo: string): Promise<AnalisisIaDto>;
}
