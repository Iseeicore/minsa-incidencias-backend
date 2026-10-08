import { Router } from "express";
import { z } from "zod";
import { AREAS_CURSOR_LONGITUD_MAXIMA, AREAS_LIMITE_MAXIMO, AREAS_LIMITE_POR_DEFECTO } from "@/constants/areas.js";
import { TEXTO_BUSQUEDA_MAXIMO } from "@/constants/incidencias.js";
import { TipoArea } from "@/enums/tipo-area.enum.js";
import { requireSession } from "@/middleware/session.js";
import type { AreaServicio } from "@/services/area.types.js";
import type { SesionActual } from "@/services/auth.types.js";
import { decodificarCursorDeAreas } from "@/utils/cursor-areas.js";

const listadoSchema = z.object({
  tipo: z.enum(Object.values(TipoArea) as [TipoArea, ...TipoArea[]]).optional(),
  q: z
    .string()
    .trim()
    .max(TEXTO_BUSQUEDA_MAXIMO)
    .optional()
    .transform((texto) => (texto ? texto : undefined)),
  limite: z.coerce.number().int().min(1).max(AREAS_LIMITE_MAXIMO).default(AREAS_LIMITE_POR_DEFECTO),
  cursor: z
    .string()
    .max(AREAS_CURSOR_LONGITUD_MAXIMA)
    .optional()
    .transform((cursor, contexto) => {
      if (!cursor) return undefined;
      const posicion = decodificarCursorDeAreas(cursor);
      if (!posicion) contexto.addIssue({ code: "custom", message: "El cursor no es válido." });
      return posicion ?? undefined;
    }),
});

export function createAreasRouter(servicio: AreaServicio): Router {
  const router = Router();

  // Solo pide sesión: qué áreas ve cada persona lo decide el servicio según sus roles.
  router.get("/areas", requireSession, async (req, res) => {
    const { q, cursor, ...consulta } = listadoSchema.parse(req.query);
    res.json(
      await servicio.listar(req.sesion as SesionActual, {
        ...consulta,
        ...(q ? { texto: q } : {}),
        ...(cursor ? { despuesDe: cursor } : {}),
      }),
    );
  });

  return router;
}
