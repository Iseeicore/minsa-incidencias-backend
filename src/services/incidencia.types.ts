import type { CategoriaApi, EstadoApi } from "@/constants/incidencias.js";
import type { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
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
}

export interface DatosAccion {
  categoria?: CategoriaApi;
  resolucion?: string;
  /** Código del área de destino al derivar; si falta, la del establecimiento de origen. */
  areaDestino?: string;
}

export interface AreaDto {
  codigo: string;
  nombre: string;
}

export interface EstablecimientoDto {
  codigoRenipress: string;
  nombre: string;
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

export interface CasoDetalleDto extends CasoResumenDto {
  resolucion: string | null;
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

export interface IncidenciaServicio {
  listar(sesion: SesionActual, consulta: ConsultaListado): Promise<ListaCasosDto>;
  detalle(sesion: SesionActual, codigo: string): Promise<CasoDetalleDto>;
  porVencer(sesion: SesionActual): Promise<PorVencerDto>;
  ejecutar(sesion: SesionActual, codigo: string, accion: AccionIncidencia, datos: DatosAccion): Promise<ResultadoAccionDto>;
}
