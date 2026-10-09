import type { TipoArea } from "@/enums/tipo-area.enum.js";
import type { PosicionDeAreas } from "@/utils/cursor-areas.js";
import type { SesionActual } from "./auth.types.js";

export interface ConsultaAreas {
  limite: number;
  /** Posición del cursor de `siguiente`, ya decodificada; ausente en la primera página. */
  despuesDe?: PosicionDeAreas;
  tipo?: TipoArea;
  texto?: string;
}

export interface EstablecimientoDeAreaDto {
  codigoRenipress: string;
  nivelAtencion: string | null;
  categoria: string | null;
}

export interface AreaListadaDto {
  id: number;
  /** Código del área, el que acepta `areaDestino` al derivar. */
  codigo: string;
  nombre: string;
  tipoArea: TipoArea;
  establecimiento: EstablecimientoDeAreaDto | null;
}

export interface ListaAreasDto {
  items: AreaListadaDto[];
  /** Cursor para pedir la página que sigue; `null` en la última. */
  siguiente: string | null;
  hayMas: boolean;
}

export interface AreaServicio {
  listar(sesion: SesionActual, consulta: ConsultaAreas): Promise<ListaAreasDto>;
}
