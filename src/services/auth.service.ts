import { SESSION_TOUCH_INTERVAL_SECONDS } from "@/constants/limits.js";
import { actorUsuarioInterno } from "@/database/actor.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";
import type { SesionRepository } from "@/repositories/sesion.repository.js";
import type { UsuarioRepository } from "@/repositories/usuario.repository.js";
import type { PasswordHasher } from "@/utils/password-hasher.js";
import { vistasDeRoles } from "@/utils/vistas-de-roles.js";
import type { SesionActual } from "./auth.types.js";

export interface AuthSettings {
  SESSION_IDLE_MINUTES: number;
  SESSION_ABSOLUTE_HOURS: number;
}

const CLAVE_FALSA = "clave-falsa-para-igualar-los-tiempos-de-respuesta";

export const normalizarCorreo = (correo: string): string => correo.trim().toLowerCase();

export class AuthService {
  private huellaFalsa: Promise<string> | null = null;

  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly sesiones: SesionRepository,
    private readonly hasher: PasswordHasher,
    private readonly settings: AuthSettings,
  ) {}

  /**
   * Siempre verifica una clave, aunque el correo no exista o el usuario esté desactivado: así el
   * tiempo de respuesta no delata qué correos están registrados. El error es el mismo en todos los casos.
   */
  async login(correo: string, password: string): Promise<string> {
    const usuario = await this.usuarios.buscarPorCorreo(normalizarCorreo(correo));
    const huella = usuario?.passwordHash ?? (await this.obtenerHuellaFalsa());
    const coincide = await this.hasher.verify(huella, password);

    if (!usuario || !usuario.activo || !coincide) {
      throw new AppError(HttpStatus.UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS);
    }
    return this.sesiones.crear(actorUsuarioInterno(usuario.correo), usuario.id, this.settings.SESSION_ABSOLUTE_HOURS);
  }

  async resolverSesion(sesionId: string): Promise<SesionActual | null> {
    const fila = await this.sesiones.buscarVigente(
      sesionId,
      this.settings.SESSION_IDLE_MINUTES,
      SESSION_TOUCH_INTERVAL_SECONDS,
    );
    if (!fila) return null;

    if (fila.debeTocar) {
      await this.sesiones.tocarActividad(actorUsuarioInterno(fila.correo), fila.sesionId);
    }
    return {
      sesionId: fila.sesionId,
      usuarioId: fila.usuarioId,
      correo: fila.correo,
      nombreCompleto: fila.nombreCompleto,
      roles: fila.roles,
      area: fila.area,
      vistas: vistasDeRoles(fila.roles),
    };
  }

  async cerrarSesion(sesion: SesionActual): Promise<void> {
    await this.sesiones.revocar(actorUsuarioInterno(sesion.correo), sesion.sesionId);
  }

  private obtenerHuellaFalsa(): Promise<string> {
    this.huellaFalsa ??= this.hasher.hash(CLAVE_FALSA);
    return this.huellaFalsa;
  }
}
