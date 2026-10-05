import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import { requireVista } from "@/middleware/session.js";
import type { SesionActual } from "@/services/auth.types.js";

const sesion = (vistas: VistaCodigo[]): SesionActual => ({
  sesionId: "s-1",
  usuarioId: "u-1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  vistas,
});

function ejecutar(vista: VistaCodigo, req: Partial<Request>, locals: Record<string, unknown> = {}) {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  requireVista(vista)(req as Request, { locals } as unknown as Response, next);
  return next;
}

describe("requireVista", () => {
  it("deja pasar a quien tiene la vista", () => {
    const next = ejecutar(VistaCodigo.CASOS, { sesion: sesion([VistaCodigo.INICIO, VistaCodigo.CASOS]) });
    expect(next).toHaveBeenCalledWith();
  });

  it("responde 403 FORBIDDEN a quien no la tiene", () => {
    const next = ejecutar(VistaCodigo.DERIVACIONES, { sesion: sesion([VistaCodigo.INICIO]) });
    const error = next.mock.calls[0]?.[0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe(ErrorCode.FORBIDDEN);
  });

  it("responde 403 a una sesión válida sin ninguna vista", () => {
    const next = ejecutar(VistaCodigo.INICIO, { sesion: sesion([]) });
    expect((next.mock.calls[0]?.[0] as AppError).statusCode).toBe(403);
  });

  it("responde 401 UNAUTHORIZED sin sesión", () => {
    const next = ejecutar(VistaCodigo.INICIO, {});
    const error = next.mock.calls[0]?.[0] as AppError;
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe(ErrorCode.UNAUTHORIZED);
  });

  it("responde 401 INVALID_SESSION si la cookie ya no servía", () => {
    const next = ejecutar(VistaCodigo.INICIO, {}, { sesionInvalida: true });
    expect((next.mock.calls[0]?.[0] as AppError).errorCode).toBe(ErrorCode.INVALID_SESSION);
  });
});
