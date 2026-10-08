import type { CategoriaApi, EstadoApi, MotivoDeArchivoManual } from "@/constants/incidencias.js";
import type { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import type { MotivoArchivo } from "@/enums/motivo-archivo.enum.js";
import type { ResultadoResolucion } from "@/enums/resultado-resolucion.enum.js";
import type { PosicionDeListado } from "@/utils/cursor-listado.js";
import type { PlazoCalculado } from "@/utils/plazo-incidencia.js";
import type { ItemDeHistorial } from "@/utils/historial-incidencia.js";
import type { SesionActual } from "./auth.types.js";

export interface ConsultaListado {
  limite: number;
  /** Posición del cursor de `siguiente`, ya decodificada; ausente en la primera página. */
  despuesDe?: PosicionDeListado;
  estado?: EstadoApi;
  categoria?: CategoriaApi | "sin-categoria";
  texto?: string;
  /** Código RENIPRESS canónico (sin ceros a la izquierda) del establecimiento de origen. */
  establecimiento?: string;
  /** Solo los archivados por este motivo. */
  motivoArchivo?: MotivoArchivo;
}

export interface DatosAccion {
  categoria?: CategoriaApi;
  /** Código del área de destino al derivar; si falta, la del establecimiento de origen (o la actual, en una denuncia por corrupción). */
  areaDestino?: string;
  /** Resolver: las tres partes de la resolución. */
  medidasTomadas?: string;
  fundamento?: string;
  resultado?: ResultadoResolucion;
  /** Archivar: el motivo que elige la persona y su justificación. */
  motivoArchivo?: MotivoDeArchivoManual;
  detalle?: string;
  /** Reabrir: por qué se reabre. */
  motivoReapertura?: string;
}

export interface AreaDto {
  codigo: string;
  nombre: string;
}

export interface EstablecimientoDto {
  codigoRenipress: string;
  nombre: string;
  /** Código del nivel de atención del catálogo (I, II, III). */
  nivelAtencion: string | null;
  categoria: string | null;
}

export interface CasoResumenDto {
  codigo: string;
  categoria: CategoriaApi | null;
  categoriaIa: CategoriaApi | null;
  confianzaIa: number | null;
  etiquetas: string[];
  prioridad: null;
  organismo: null;
  area: AreaDto | null;
  establecimiento: EstablecimientoDto | null;
  responsable: string | null;
  estado: EstadoApi;
  horasDesdeLlegada: number;
  horasDesdeResolucion: number | null;
  revisadoPorHumano: boolean;
  corregida: boolean;
  plazo: PlazoCalculado;
  acciones: AccionIncidencia[];
}

export interface EvidenciaDto {
  nombre: string;
  tipo: string;
  fecha: string;
  sensible: boolean;
  verificada: boolean;
}

/** Cómo se resolvió el caso; `null` mientras no se resuelve. */
export interface ResolucionDto {
  medidasTomadas: string;
  fundamento: string;
  resultado: ResultadoResolucion;
}

/** Por qué está archivado. `detalle` es la justificación de la persona; nulo si lo archivó el sistema (vencimiento o vigencia). */
export interface ArchivoDto {
  motivo: MotivoArchivo;
  detalle: string | null;
  archivadoEn: string;
}

/** La última reapertura, también si el caso volvió a archivarse o a resolverse después. */
export interface ReaperturaDto {
  reabiertoEn: string;
  motivo: string;
}

export interface CasoDetalleDto extends CasoResumenDto {
  resolucion: ResolucionDto | null;
  archivo: ArchivoDto | null;
  reapertura: ReaperturaDto | null;
  descripcion: string;
  reclamante: string;
  evidencias: EvidenciaDto[];
  historial: ItemDeHistorial[];
}

export interface ListaCasosDto {
  items: CasoResumenDto[];
  /** Cursor para pedir la página que sigue; `null` en la última. */
  siguiente: string | null;
  hayMas: boolean;
}

export interface PorVencerDto {
  total: number;
  porVencer: number;
  vencidos: number;
  casos: CasoResumenDto[];
}

export interface ResultadoAccionDto {
  mensaje: string;
  caso: CasoDetalleDto | null;
}

/**
 * Respuesta de corregir cuando el caso pasó a corrupción y ya no es visible para quien lo corrigió (un establecimiento
 * o un gestor): solo el código y la marca, nunca datos del caso. Es irreversible para esa persona.
 */
export interface CasoEnviadoAOtransDto {
  codigo: string;
  enviadoAOtrans: true;
}

export interface IncidenciaServicio {
  listar(sesion: SesionActual, consulta: ConsultaListado): Promise<ListaCasosDto>;
  detalle(sesion: SesionActual, codigo: string): Promise<CasoDetalleDto>;
  porVencer(sesion: SesionActual): Promise<PorVencerDto>;
  ejecutar(
    sesion: SesionActual,
    codigo: string,
    accion: AccionIncidencia,
    datos: DatosAccion,
  ): Promise<ResultadoAccionDto | CasoEnviadoAOtransDto>;
}
