import { describe, expect, it, vi } from "vitest";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { TipoArea } from "@/enums/tipo-area.enum.js";
import { AppError } from "@/errors/app-error.js";
import type { SesionConUsuario, SesionRepository } from "@/repositories/sesion.repository.js";
import type { UsuarioInterno, UsuarioRepository } from "@/repositories/usuario.repository.js";
import { AuthService } from "@/services/auth.service.js";
import type { PasswordHasher } from "@/utils/password-hasher.js";

const ANA: UsuarioInterno = {
  id: "u-1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  passwordHash: "hash:clave-correcta",
  activo: true,
};

function build(usuario: UsuarioInterno | null = ANA, vigente: SesionConUsuario | null = null) {
  const hasher: PasswordHasher = {
    hash: vi.fn(async (plain: string) => `hash:${plain}`),
    verify: vi.fn(async (hashed: string, plain: string) => hashed === `hash:${plain}`),
  };
  const usuarios = { buscarPorCorreo: vi.fn(async () => usuario) } as unknown as UsuarioRepository;
  const sesiones = {
    crear: vi.fn(async () => "sesion-nueva"),
    buscarVigente: vi.fn(async () => vigente),
    tocarActividad: vi.fn(async () => undefined),
    revocar: vi.fn(async () => undefined),
  } as unknown as SesionRepository;
  const service = new AuthService(usuarios, sesiones, hasher, { SESSION_IDLE_MINUTES: 30, SESSION_ABSOLUTE_HOURS: 8 });
  return { service, usuarios, sesiones, hasher };
}

async function falla(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }
  throw new Error("debía fallar");
}

describe("AuthService.login", () => {
  it("con la clave correcta crea una sesión de 8 horas firmada por el usuario", async () => {
    const { service, sesiones } = build();
    expect(await service.login("ana@minsa.gob.pe", "clave-correcta")).toBe("sesion-nueva");
    expect(sesiones.crear).toHaveBeenCalledWith("usuario:ana@minsa.gob.pe", "u-1", 8);
  });

  it("normaliza el correo antes de buscarlo", async () => {
    const { service, usuarios } = build();
    await service.login("  ANA@Minsa.gob.pe ", "clave-correcta");
    expect(usuarios.buscarPorCorreo).toHaveBeenCalledWith("ana@minsa.gob.pe");
  });

  it("con clave incorrecta responde 401 INVALID_CREDENTIALS y no crea sesión", async () => {
    const { service, sesiones } = build();
    const error = await falla(service.login("ana@minsa.gob.pe", "mala"));
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(sesiones.crear).not.toHaveBeenCalled();
  });

  it("con un correo inexistente da el mismo error y aun así verifica una clave (mismo tiempo)", async () => {
    const { service, hasher } = build(null);
    const error = await falla(service.login("nadie@minsa.gob.pe", "cualquiera"));
    expect(error.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(hasher.verify).toHaveBeenCalledTimes(1);
  });

  it("con un usuario desactivado da el mismo error aunque la clave sea correcta", async () => {
    const { service, sesiones } = build({ ...ANA, activo: false });
    const error = await falla(service.login("ana@minsa.gob.pe", "clave-correcta"));
    expect(error.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(sesiones.crear).not.toHaveBeenCalled();
  });
});

describe("AuthService.resolverSesion", () => {
  const vigente: SesionConUsuario = {
    sesionId: "s-1",
    usuarioId: "u-1",
    correo: "ana@minsa.gob.pe",
    nombreCompleto: "Ana Prueba",
    roles: ["GESTOR"],
    area: null,
    debeTocar: false,
  };

  it("devuelve null si no hay sesión vigente", async () => {
    expect(await build(ANA, null).service.resolverSesion("s-1")).toBeNull();
  });

  it("devuelve las vistas de los roles y no toca la actividad si es reciente", async () => {
    const { service, sesiones } = build(ANA, vigente);
    const sesion = await service.resolverSesion("s-1");
    expect(sesion?.vistas).toEqual(["INICIO", "CASOS", "BANDEJAS", "DERIVACIONES"]);
    expect(sesiones.buscarVigente).toHaveBeenCalledWith("s-1", 30, 60);
    expect(sesiones.tocarActividad).not.toHaveBeenCalled();
  });

  it("la sesión de la petición lleva los roles para el servidor, que nunca los envía al navegador", async () => {
    const sesion = await build(ANA, vigente).service.resolverSesion("s-1");
    expect(Object.keys(sesion ?? {}).sort()).toEqual(["area", "correo", "nombreCompleto", "roles", "sesionId", "usuarioId", "vistas"]);
    expect(sesion?.roles).toEqual(["GESTOR"]);
  });

  it("ignora los roles que no conoce, incluido DIRIS, que está desactivado", async () => {
    const { service } = build(ANA, { ...vigente, roles: ["DIRIS", "ROL_INVENTADO"] });
    expect((await service.resolverSesion("s-1"))?.vistas).toEqual([]);
  });

  it("la sesión lleva el área de la persona tal como la entrega el repositorio", async () => {
    const area = { id: 7, codigo: "EESS-6206", nombre: "Hospital Dos de Mayo", tipo: TipoArea.ESTABLECIMIENTO };
    const sesion = await build(ANA, { ...vigente, roles: ["ESTABLECIMIENTO"], area }).service.resolverSesion("s-1");
    expect(sesion?.area).toEqual(area);
  });

  it("una persona sin ningún rol activo tiene sesión válida y ninguna vista", async () => {
    const { service } = build(ANA, { ...vigente, roles: [] });
    const sesion = await service.resolverSesion("s-1");
    expect(sesion).not.toBeNull();
    expect(sesion?.vistas).toEqual([]);
  });

  it("renueva la actividad cuando pasó el intervalo", async () => {
    const { service, sesiones } = build(ANA, { ...vigente, debeTocar: true });
    await service.resolverSesion("s-1");
    expect(sesiones.tocarActividad).toHaveBeenCalledWith("usuario:ana@minsa.gob.pe", "s-1");
  });
});

describe("AuthService.cerrarSesion", () => {
  it("revoca la sesión con el actor de la persona", async () => {
    const { service, sesiones } = build();
    await service.cerrarSesion({ sesionId: "s-1", usuarioId: "u-1", correo: "ana@minsa.gob.pe", nombreCompleto: "Ana", roles: [], area: null, vistas: [] });
    expect(sesiones.revocar).toHaveBeenCalledWith("usuario:ana@minsa.gob.pe", "s-1");
  });
});
