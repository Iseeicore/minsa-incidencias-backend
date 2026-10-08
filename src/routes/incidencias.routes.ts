import { Router, type Request } from "express";
import { z } from "zod";
import {
  CATEGORIAS_API,
  AREA_CODIGO_LONGITUD_MAXIMA,
  CODIGO_INCIDENCIA_PATRON,
  CODIGO_RENIPRESS_PATRON,
  CURSOR_LONGITUD_MAXIMA,
  ESTADOS_API,
  LISTADO_LIMITE_MAXIMO,
  LISTADO_LIMITE_POR_DEFECTO,
  RESOLUCION_LONGITUD_MAXIMA,
  SIN_CATEGORIA_API,
  TEXTO_BUSQUEDA_MAXIMO,
} from "@/constants/incidencias.js";
import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import { requireSession, requireVista } from "@/middleware/session.js";
import type { SesionActual } from "@/services/auth.types.js";
import { decodificarCursor } from "@/utils/cursor-listado.js";
import type { DatosAccion, IncidenciaServicio } from "@/services/incidencia.types.js";

const listadoSchema = z.object({
  limite: z.coerce.number().int().min(1).max(LISTADO_LIMITE_MAXIMO).default(LISTADO_LIMITE_POR_DEFECTO),
  cursor: z
    .string()
    .max(CURSOR_LONGITUD_MAXIMA)
    .optional()
    .transform((cursor, contexto) => {
      if (!cursor) return undefined;
      const posicion = decodificarCursor(cursor);
      if (!posicion) contexto.addIssue({ code: "custom", message: "El cursor no es válido." });
      return posicion ?? undefined;
    }),
  estado: z.enum(ESTADOS_API).optional(),
  categoria: z.enum([...CATEGORIAS_API, SIN_CATEGORIA_API]).optional(),
  texto: z
    .string()
    .trim()
    .max(TEXTO_BUSQUEDA_MAXIMO)
    .optional()
    .transform((texto) => (texto ? texto : undefined)),
  // Código RENIPRESS: se quitan los ceros a la izquierda y debe quedar de 1 a 8 dígitos sin cero inicial.
  establecimiento: z
    .string()
    .trim()
    .optional()
    .transform((codigo, contexto) => {
      if (!codigo) return undefined;
      const canonico = codigo.replace(/^0+/, "");
      if (!CODIGO_RENIPRESS_PATRON.test(canonico)) {
        contexto.addIssue({ code: "custom", message: "El código del establecimiento no es válido." });
        return undefined;
      }
      return canonico;
    }),
});

const sinDatosSchema = z.object({});
const correccionSchema = z.object({ categoria: z.enum(CATEGORIAS_API) });
const resolucionSchema = z.object({ resolucion: z.string().trim().min(1).max(RESOLUCION_LONGITUD_MAXIMA) });

const derivacionSchema = z.object({ areaDestino: z.string().trim().min(1).max(AREA_CODIGO_LONGITUD_MAXIMA).optional() });

const SCHEMA_DE_ACCION: Record<AccionIncidencia, z.ZodType<DatosAccion>> = {
  [AccionIncidencia.CONFIRMAR]: sinDatosSchema,
  [AccionIncidencia.CORREGIR]: correccionSchema,
  [AccionIncidencia.DERIVAR]: derivacionSchema,
  [AccionIncidencia.TOMAR]: sinDatosSchema,
  [AccionIncidencia.RESOLVER]: resolucionSchema,
};

const sesionDe = (req: Request): SesionActual => req.sesion as SesionActual;

/** Un código con forma inválida no puede existir: responde igual que un caso que no existe. */
function codigoDe(req: Request): string {
  const codigo = String(req.params["codigo"]);
  if (!CODIGO_INCIDENCIA_PATRON.test(codigo)) throw new AppError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
  return codigo;
}

export function createIncidenciasRouter(servicio: IncidenciaServicio): Router {
  const router = Router();
  const verCasos = requireVista(VistaCodigo.CASOS);

  router.get("/incidencias", verCasos, async (req, res) => {
    const { cursor, ...consulta } = listadoSchema.parse(req.query);
    res.json(await servicio.listar(sesionDe(req), cursor ? { ...consulta, despuesDe: cursor } : consulta));
  });

  router.get("/incidencias/por-vencer", requireSession, async (req, res) => {
    res.json(await servicio.porVencer(sesionDe(req)));
  });

  router.get("/incidencias/:codigo", verCasos, async (req, res) => {
    res.json(await servicio.detalle(sesionDe(req), codigoDe(req)));
  });

  for (const accion of Object.values(AccionIncidencia)) {
    router.post(`/incidencias/:codigo/${accion}`, verCasos, async (req, res) => {
      const codigo = codigoDe(req);
      const datos = SCHEMA_DE_ACCION[accion].parse(req.body ?? {});
      res.json(await servicio.ejecutar(sesionDe(req), codigo, accion, datos));
    });
  }

  return router;
}
