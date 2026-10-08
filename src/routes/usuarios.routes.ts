import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { MAX_EMAIL_LENGTH } from "@/constants/limits.js";
import { AREA_CODIGO_LONGITUD_MAXIMA, TEXTO_BUSQUEDA_MAXIMO } from "@/constants/incidencias.js";
import type { RolVigente } from "@/constants/permisos-por-rol.js";
import {
  USUARIO_ID_PATRON,
  USUARIO_NOMBRE_LONGITUD_MAXIMA,
  USUARIO_NOMBRE_LONGITUD_MINIMA,
  USUARIOS_CURSOR_LONGITUD_MAXIMA,
  USUARIOS_LIMITE_MAXIMO,
  USUARIOS_LIMITE_POR_DEFECTO,
} from "@/constants/usuarios.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import { requireVista } from "@/middleware/session.js";
import type { SesionActual } from "@/services/auth.types.js";
import type { UsuarioServicio } from "@/services/usuario.types.js";
import { decodificarCursorDeUsuarios } from "@/utils/cursor-usuarios.js";

const ROLES_ASIGNABLES = [RolCodigo.ADMINISTRADOR, RolCodigo.GESTOR, RolCodigo.OTRANS, RolCodigo.ESTABLECIMIENTO] as const satisfies readonly RolVigente[];

const textoOpcional = (maximo: number) =>
  z
    .string()
    .trim()
    .max(maximo)
    .optional()
    .transform((texto) => (texto ? texto : undefined));

const listadoSchema = z.object({
  limite: z.coerce.number().int().min(1).max(USUARIOS_LIMITE_MAXIMO).default(USUARIOS_LIMITE_POR_DEFECTO),
  cursor: z
    .string()
    .max(USUARIOS_CURSOR_LONGITUD_MAXIMA)
    .optional()
    .transform((cursor, contexto) => {
      if (!cursor) return undefined;
      const posicion = decodificarCursorDeUsuarios(cursor);
      if (!posicion) contexto.addIssue({ code: "custom", message: "El cursor no es válido." });
      return posicion ?? undefined;
    }),
  q: textoOpcional(TEXTO_BUSQUEDA_MAXIMO),
  area: textoOpcional(AREA_CODIGO_LONGITUD_MAXIMA),
});

const nombreSchema = z.string().trim().min(USUARIO_NOMBRE_LONGITUD_MINIMA).max(USUARIO_NOMBRE_LONGITUD_MAXIMA);
// El correo se normaliza antes de validarlo: sin espacios y en minúsculas, que es como lo guarda la base.
const correoSchema = z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH).pipe(z.email());
const rolSchema = z.enum(ROLES_ASIGNABLES);
const areaSchema = z.string().trim().min(1).max(AREA_CODIGO_LONGITUD_MAXIMA);

const creacionSchema = z.object({ nombreCompleto: nombreSchema, correo: correoSchema, rol: rolSchema, area: areaSchema.optional() });

const cambiosSchema = z
  .object({ nombreCompleto: nombreSchema.optional(), rol: rolSchema.optional(), activo: z.boolean().optional(), area: areaSchema.optional() })
  .refine((cambios) => Object.values(cambios).some((valor) => valor !== undefined), { message: "Indica al menos un dato para cambiar." });

const sesionDe = (req: Request): SesionActual => req.sesion as SesionActual;

/** Un id con forma inválida no puede existir: responde igual que un usuario que no existe. */
function idDe(req: Request): string {
  const id = String(req.params["id"]);
  if (!USUARIO_ID_PATRON.test(id)) throw new AppError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND);
  return id;
}

/** La clave inicial viaja una sola vez: ningún intermediario ni el navegador deben guardarla. */
const sinGuardar = (res: Response): void => {
  res.set("Cache-Control", "no-store");
};

export function createUsuariosRouter(servicio: UsuarioServicio): Router {
  const router = Router();
  const gestionarUsuarios = requireVista(VistaCodigo.USUARIOS);

  router.get("/usuarios", gestionarUsuarios, async (req, res) => {
    const { q, area, cursor, ...consulta } = listadoSchema.parse(req.query);
    res.json(
      await servicio.listar(sesionDe(req), {
        ...consulta,
        ...(q ? { texto: q } : {}),
        ...(area ? { area } : {}),
        ...(cursor ? { despuesDe: cursor } : {}),
      }),
    );
  });

  router.post("/usuarios", gestionarUsuarios, async (req, res) => {
    const datos = creacionSchema.parse(req.body);
    const creado = await servicio.crear(sesionDe(req), datos);
    sinGuardar(res);
    res.status(HttpStatus.CREATED).json(creado);
  });

  router.patch("/usuarios/:id", gestionarUsuarios, async (req, res) => {
    const id = idDe(req);
    const cambios = cambiosSchema.parse(req.body);
    res.json({ usuario: await servicio.actualizar(sesionDe(req), id, cambios) });
  });

  router.post("/usuarios/:id/restablecer-clave", gestionarUsuarios, async (req, res) => {
    const id = idDe(req);
    const restablecido = await servicio.restablecerClave(sesionDe(req), id);
    sinGuardar(res);
    res.json(restablecido);
  });

  return router;
}
