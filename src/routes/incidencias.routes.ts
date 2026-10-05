import { Router, type Request } from "express";
import { z } from "zod";
import {
  CATEGORIAS_API,
  CODIGO_INCIDENCIA_PATRON,
  ESTADOS_API,
  ORDEN_API,
  PAGINA_TAMANO_MAXIMO,
  PAGINA_TAMANO_POR_DEFECTO,
  RESOLUCION_LONGITUD_MAXIMA,
  SIN_CATEGORIA_API,
  TEXTO_BUSQUEDA_MAXIMO,
} from "@/constants/incidencias.js";
import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { DireccionOrden, OrdenIncidencia } from "@/enums/orden-incidencia.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import { requireSession, requireVista } from "@/middleware/session.js";
import type { SesionActual } from "@/services/auth.types.js";
import type { DatosAccion, IncidenciaServicio } from "@/services/incidencia.types.js";

const listadoSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  tamano: z.coerce.number().int().min(1).max(PAGINA_TAMANO_MAXIMO).default(PAGINA_TAMANO_POR_DEFECTO),
  estado: z.enum(ESTADOS_API).optional(),
  categoria: z.enum([...CATEGORIAS_API, SIN_CATEGORIA_API]).optional(),
  texto: z
    .string()
    .trim()
    .max(TEXTO_BUSQUEDA_MAXIMO)
    .optional()
    .transform((texto) => (texto ? texto : undefined)),
  orden: z.enum(ORDEN_API).default(OrdenIncidencia.FECHA),
  direccion: z.enum([DireccionOrden.ASCENDENTE, DireccionOrden.DESCENDENTE]).default(DireccionOrden.ASCENDENTE),
});

const sinDatosSchema = z.object({});
const correccionSchema = z.object({ categoria: z.enum(CATEGORIAS_API) });
const resolucionSchema = z.object({ resolucion: z.string().trim().min(1).max(RESOLUCION_LONGITUD_MAXIMA) });

const SCHEMA_DE_ACCION: Record<AccionIncidencia, z.ZodType<DatosAccion>> = {
  [AccionIncidencia.CONFIRMAR]: sinDatosSchema,
  [AccionIncidencia.CORREGIR]: correccionSchema,
  [AccionIncidencia.DERIVAR]: sinDatosSchema,
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
    const consulta = listadoSchema.parse(req.query);
    res.json(await servicio.listar(sesionDe(req), consulta));
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
