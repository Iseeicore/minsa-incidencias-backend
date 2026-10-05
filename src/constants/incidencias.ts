import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { OrdenIncidencia } from "@/enums/orden-incidencia.enum.js";

export const PAGINA_TAMANO_POR_DEFECTO = 20;
export const PAGINA_TAMANO_MAXIMO = 100;
export const POR_VENCER_LISTA_MAXIMA = 10;
export const TEXTO_BUSQUEDA_MAXIMO = 100;
export const RESOLUCION_LONGITUD_MAXIMA = 4000;
export const CODIGO_INCIDENCIA_PATRON = /^MINSA-\d{4}-\d{6,}$/;
export const MILISEGUNDOS_POR_HORA = 3_600_000;
export const HORAS_POR_DIA = 24;
export const SIN_CATEGORIA_API = "sin-categoria";
export const ROL_AREA_PATRON_SQL = "AREA\\_%";
export const ACTOR_PREFIJO_USUARIO = "usuario:";
export const ACTOR_PREFIJO_SISTEMA = "sistema:";
export const NOMBRE_ACTOR_SISTEMA = "Sistema";
export const RECLAMANTE_ANONIMO = "Anónimo";
export const RECLAMANTE_SIN_DATOS = "Sin datos";
export const DNI_ENMASCARADO = "••••";

export const ESTADO_API = {
  [EstadoIncidencia.REGISTRADO]: "registrado",
  [EstadoIncidencia.CLASIFICADO]: "clasificado",
  [EstadoIncidencia.DERIVADO]: "derivado",
  [EstadoIncidencia.EN_GESTION]: "en-gestion",
  [EstadoIncidencia.RESUELTO]: "resuelto",
  [EstadoIncidencia.ARCHIVADO]: "archivado",
} as const;
export type EstadoApi = (typeof ESTADO_API)[EstadoIncidencia];
export const ESTADOS_API = Object.values(ESTADO_API) as [EstadoApi, ...EstadoApi[]];
export const ESTADO_DESDE_API = Object.fromEntries(
  Object.entries(ESTADO_API).map(([estado, api]) => [api, estado]),
) as Record<EstadoApi, EstadoIncidencia>;

export const CATEGORIA_API = {
  [CategoriaIncidencia.DENUNCIA_CORRUPCION]: "denuncia-corrupcion",
  [CategoriaIncidencia.QUEJA]: "queja",
  [CategoriaIncidencia.RECLAMO]: "reclamo",
  [CategoriaIncidencia.OTRO]: "otro",
} as const;
export type CategoriaApi = (typeof CATEGORIA_API)[CategoriaIncidencia];
export const CATEGORIAS_API = Object.values(CATEGORIA_API) as [CategoriaApi, ...CategoriaApi[]];
export const CATEGORIA_DESDE_API = Object.fromEntries(
  Object.entries(CATEGORIA_API).map(([categoria, api]) => [api, categoria]),
) as Record<CategoriaApi, CategoriaIncidencia>;

export const CATEGORIA_ETIQUETA: Record<CategoriaIncidencia, string> = {
  [CategoriaIncidencia.DENUNCIA_CORRUPCION]: "Denuncia por corrupción",
  [CategoriaIncidencia.QUEJA]: "Queja",
  [CategoriaIncidencia.RECLAMO]: "Reclamo",
  [CategoriaIncidencia.OTRO]: "Otro",
};

export const ESTADOS_ABIERTOS: readonly EstadoIncidencia[] = [
  EstadoIncidencia.REGISTRADO,
  EstadoIncidencia.CLASIFICADO,
  EstadoIncidencia.DERIVADO,
  EstadoIncidencia.EN_GESTION,
];

export const ORDEN_SQL: Record<OrdenIncidencia, string> = {
  [OrdenIncidencia.FECHA]: "i.fecha_creacion",
  [OrdenIncidencia.CODIGO]: "i.codigo",
  [OrdenIncidencia.CATEGORIA]: "c.codigo",
  [OrdenIncidencia.ESTADO]: "e.codigo",
  [OrdenIncidencia.CONFIANZA]: "i.categoria_confianza",
};

export const ORDEN_API = Object.values(OrdenIncidencia) as [OrdenIncidencia, ...OrdenIncidencia[]];

export const ACCIONES_EN_ORDEN: readonly AccionIncidencia[] = Object.values(AccionIncidencia);

export const CATEGORIAS_CON_AREA: readonly CategoriaIncidencia[] = [
  CategoriaIncidencia.DENUNCIA_CORRUPCION,
  CategoriaIncidencia.QUEJA,
  CategoriaIncidencia.RECLAMO,
];
