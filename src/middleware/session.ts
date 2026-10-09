import type { RequestHandler } from "express";
import type { Env } from "@/config/env.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import type { RolCodigo } from "@/enums/rol-codigo.enum.js";
import type { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import type { AuthService } from "@/services/auth.service.js";
import { clearSessionCookie, readSessionId } from "@/utils/session-cookie.js";

/**
 * Identifica a la persona si trae una cookie de sesión válida, pero nunca rechaza: las rutas que
 * exigen sesión usan `requireSession`. Si la cookie ya no sirve (revocada, vencida o usuario
 * desactivado) la borra para que el navegador no la siga enviando.
 */
export function attachSession(auth: AuthService, env: Env): RequestHandler {
  return async (req, res, next) => {
    const sesionId = readSessionId(req);
    if (!sesionId) {
      next();
      return;
    }
    try {
      const sesion = await auth.resolverSesion(sesionId);
      if (sesion) {
        req.sesion = sesion;
      } else {
        res.locals.sesionInvalida = true;
        clearSessionCookie(res, env);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireSession: RequestHandler = (req, res, next) => {
  if (req.sesion) {
    next();
    return;
  }
  const code = res.locals.sesionInvalida ? ErrorCode.INVALID_SESSION : ErrorCode.UNAUTHORIZED;
  next(new AppError(HttpStatus.UNAUTHORIZED, code));
};

/** Exige que la persona tenga alguno de estos roles. Para herramientas internas que no son una vista (p. ej. el filtro de corrupción). */
export function requireRol(...roles: RolCodigo[]): RequestHandler {
  return (req, res, next) => {
    if (!req.sesion) {
      requireSession(req, res, next);
      return;
    }
    if (!req.sesion.roles.some((rol) => (roles as string[]).includes(rol))) {
      next(new AppError(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN));
      return;
    }
    next();
  };
}

export function requireVista(vista: VistaCodigo): RequestHandler {
  return (req, res, next) => {
    if (!req.sesion) {
      requireSession(req, res, next);
      return;
    }
    if (!req.sesion.vistas.includes(vista)) {
      next(new AppError(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN));
      return;
    }
    next();
  };
}
