import { Router, type Request } from "express";
import { CODIGO_INCIDENCIA_PATRON } from "@/constants/incidencias.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import { requireRol, requireVista } from "@/middleware/session.js";
import type { SesionActual } from "@/services/auth.types.js";
import type { AnalisisIncidenciaServicio } from "@/services/analisis-incidencia/analisis-incidencia.types.js";

const sesionDe = (req: Request): SesionActual => req.sesion as SesionActual;

/** Un código con forma inválida no puede existir: responde igual que un caso que no existe. */
function codigoDe(req: Request): string {
  const codigo = String(req.params["codigo"]);
  if (!CODIGO_INCIDENCIA_PATRON.test(codigo))
    throw new AppError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
  return codigo;
}

/**
 * `GET /incidencias/:codigo/analisis-ia`: el análisis de la IA de un caso (explicación, señales, supuestos de la norma, requisitos que
 * faltan, ficha de derivación y nombre mencionado). **Solo OTRANS y ADMINISTRADOR**: un establecimiento o un gestor reciben 403, porque
 * el análisis lleva una acusación sin comprobar. Solo lectura.
 */
export function createAnalisisIncidenciaRouter(
  servicio: AnalisisIncidenciaServicio,
): Router {
  const router = Router();
  router.get(
    "/incidencias/:codigo/analisis-ia",
    requireVista(VistaCodigo.CASOS),
    requireRol(RolCodigo.OTRANS, RolCodigo.ADMINISTRADOR),
    async (req, res) => {
      res.json(await servicio.obtener(sesionDe(req), codigoDe(req)));
    },
  );
  return router;
}
