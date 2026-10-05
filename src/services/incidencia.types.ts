import type { CategoriaApi, EstadoApi } from "@/constants/incidencias.js";
import type { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import type { DireccionOrden, OrdenIncidencia } from "@/enums/orden-incidencia.enum.js";
import type { PlazoCalculado } from "@/utils/plazo-incidencia.js";
import type { ItemDeHistorial } from "@/utils/historial-incidencia.js";
import type { SesionActual } from "./auth.types.js";

export interface ConsultaListado {
  pagina: number;
  tamano: number;
  estado?: EstadoApi;
  categoria?: CategoriaApi | "sin-categoria";
  texto?: string;
  orden: OrdenIncidencia;
  direccion: DireccionOrden;
}

export interface DatosAccion {
  categoria?: CategoriaApi;
  resolucion?: string;
}

export interface CasoResumenDto {
  codigo: string;
  categoria: CategoriaApi | null;
  categoriaIa: CategoriaApi | null;
  confianzaIa: number | null;
  etiquetas: string[];
  prioridad: null;
  organismo: null;
  area: string | null;
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
  casos: CasoResumenDto[];
  pagina: number;
  tamano: number;
  total: number;
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
