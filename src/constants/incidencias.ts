import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { MotivoArchivo } from "@/enums/motivo-archivo.enum.js";
import { ResultadoResolucion } from "@/enums/resultado-resolucion.enum.js";

export const LISTADO_LIMITE_POR_DEFECTO = 20;
export const LISTADO_LIMITE_MAXIMO = 100;
export const CURSOR_LONGITUD_MAXIMA = 200;
/** Días que puede abarcar el rango `desde`-`hasta` del listado (ambos extremos incluidos): evita recorrer toda la tabla. */
export const LISTADO_RANGO_MAXIMO_DIAS = 366;
/**
 * Tope de cada contador de `GET /incidencias/conteos`: se cuentan como mucho este número de casos (la consulta se
 * detiene en tope + 1), así que ninguna cuenta recorre la tabla entera. Si hay más, la cantidad es el tope y `conMas` es true.
 */
export const CONTEO_TOPE = 1000;
export const AREA_CODIGO_LONGITUD_MAXIMA = 50;
export const POR_VENCER_LISTA_MAXIMA = 10;
export const TEXTO_BUSQUEDA_MAXIMO = 100;
export const RESOLUCION_LONGITUD_MAXIMA = 4000;
/** La base exige al menos 10 caracteres (sin contar espacios de los bordes) en las medidas, el fundamento, el detalle del archivo y el motivo de reapertura. */
export const TEXTO_DE_REVISION_LONGITUD_MINIMA = 10;
export const ARCHIVO_DETALLE_LONGITUD_MAXIMA = 2000;
export const REAPERTURA_MOTIVO_LONGITUD_MAXIMA = 2000;
export const CODIGO_INCIDENCIA_PATRON = /^MINSA-\d{4}-\d{6,}$/;
export const CODIGO_RENIPRESS_PATRON = /^[1-9][0-9]{0,7}$/;
export const MILISEGUNDOS_POR_HORA = 3_600_000;
export const HORAS_POR_DIA = 24;
export const SIN_CATEGORIA_API = "sin-categoria";
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

/** Los dos motivos que una persona puede elegir al archivar; los otros dos los pone el sistema. */
export const MOTIVOS_DE_ARCHIVO_MANUAL = [MotivoArchivo.DATOS_INSUFICIENTES, MotivoArchivo.NO_CORRESPONDE] as const;
export type MotivoDeArchivoManual = (typeof MOTIVOS_DE_ARCHIVO_MANUAL)[number];
export const MOTIVOS_DE_ARCHIVO = Object.values(MotivoArchivo) as [MotivoArchivo, ...MotivoArchivo[]];
export const RESULTADOS_DE_RESOLUCION = Object.values(ResultadoResolucion) as [ResultadoResolucion, ...ResultadoResolucion[]];

export const ESTADOS_ABIERTOS: readonly EstadoIncidencia[] = [
  EstadoIncidencia.REGISTRADO,
  EstadoIncidencia.CLASIFICADO,
  EstadoIncidencia.DERIVADO,
  EstadoIncidencia.EN_GESTION,
];

export const ACCIONES_EN_ORDEN: readonly AccionIncidencia[] = Object.values(AccionIncidencia);

