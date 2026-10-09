import { AlcanceDeUsuarios, type GestionDeUsuarios, type RolVigente } from "@/constants/permisos-por-rol.js";
import { actorUsuarioInterno } from "@/database/actor.js";
import type { Database, DbExecutor } from "@/database/database.js";
import { traducirErrorDeBase } from "@/database/reglas-de-la-base.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import type { FilaUsuarioGestion, FiltrosDeUsuarios, UsuarioGestionRepository } from "@/repositories/usuario-gestion.repository.js";
import { generarClaveInicial } from "@/utils/clave-inicial.js";
import { codificarCursorDeUsuarios } from "@/utils/cursor-usuarios.js";
import { gestionDeUsuarios } from "@/utils/gestion-de-usuarios.js";
import type { PasswordHasher } from "@/utils/password-hasher.js";
import type { SesionActual } from "./auth.types.js";
import type {
  CambiosDeUsuario,
  ConsultaUsuarios,
  DatosNuevoUsuario,
  ListaUsuariosDto,
  UsuarioConClaveDto,
  UsuarioDto,
  UsuarioServicio,
} from "./usuario.types.js";

const UNIQUE_VIOLATION = "23505";
const RESTRICCION_CORREO_UNICO = "uq_usuario_interno_correo";

const MENSAJE_USUARIO_NO_ENCONTRADO = "El usuario solicitado no existe.";
const MENSAJE_ROL_NO_ASIGNABLE = "No puedes asignar ese rol.";
const MENSAJE_SIN_AREA_PROPIA = "Tu usuario no tiene un establecimiento asignado: no puedes gestionar usuarios.";
const MENSAJE_AREA_OBLIGATORIA = "Indica el área del usuario.";
const MENSAJE_ADMINISTRADOR_SIN_AREA = "El administrador no pertenece a un área: no indiques el área.";
const MENSAJE_AREA_INVALIDA = "El área no existe o está desactivada.";
const MENSAJE_AREA_NO_PERMITIDA = "Solo el administrador cambia el área de un usuario.";

const noEncontrado = () => new AppError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, MENSAJE_USUARIO_NO_ENCONTRADO);
const sinPermiso = (mensaje?: string) => new AppError(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, mensaje);
const noProcesable = (mensaje: string) => new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, mensaje);

const aDto = (fila: FilaUsuarioGestion): UsuarioDto => ({
  id: fila.id,
  nombreCompleto: fila.nombreCompleto,
  correo: fila.correo,
  rol: fila.rol,
  activo: fila.activo,
  area: fila.areaCodigo && fila.areaNombre ? { codigo: fila.areaCodigo, nombre: fila.areaNombre } : null,
});

function esCorreoRepetido(error: unknown): boolean {
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === UNIQUE_VIOLATION && constraint === RESTRICCION_CORREO_UNICO;
}

/**
 * Usuarios internos por establecimiento. Qué puede hacer cada persona lo decide la tabla de permisos
 * (`usuarios` de cada rol): el administrador gestiona los de cualquier área; el responsable del establecimiento, solo los
 * de su propia área, y el área siempre sale de su sesión, nunca de la petición. Fuera de su alcance un usuario responde
 * `404`. La clave inicial la genera el sistema y se entrega una sola vez; en la base solo queda su huella Argon2id y
 * nunca pasa por los logs, la auditoría ni los mensajes de error. Los topes y reglas de la base se traducen a errores claros.
 */
export class UsuarioService implements UsuarioServicio {
  constructor(
    private readonly usuarios: UsuarioGestionRepository,
    private readonly database: Database,
    private readonly hasher: PasswordHasher,
  ) {}

  async listar(sesion: SesionActual, consulta: ConsultaUsuarios): Promise<ListaUsuariosDto> {
    const gestion = this.exigirGestion(sesion);
    const filtros: FiltrosDeUsuarios = {};
    if (consulta.texto) filtros.texto = consulta.texto;
    if (gestion.alcance === AlcanceDeUsuarios.SU_AREA) filtros.soloAreaId = sesion.area?.id ?? null;
    else if (consulta.area) filtros.areaCodigo = consulta.area;

    // Se pide uno de más: si llega, hay otra página y el último de esta es la posición del cursor.
    const filas = await this.usuarios.listar(filtros, consulta.limite + 1, consulta.despuesDe ?? null);
    const hayMas = filas.length > consulta.limite;
    const pagina = hayMas ? filas.slice(0, consulta.limite) : filas;
    const ultima = pagina.at(-1);
    return {
      items: pagina.map(aDto),
      siguiente: hayMas && ultima ? codificarCursorDeUsuarios({ nombre: ultima.nombreCompleto, id: ultima.id }) : null,
      hayMas,
    };
  }

  async crear(sesion: SesionActual, datos: DatosNuevoUsuario): Promise<UsuarioConClaveDto> {
    const gestion = this.exigirGestion(sesion);
    this.exigirRolAsignable(gestion, datos.rol);
    const claveInicial = generarClaveInicial();
    const huella = await this.hasher.hash(claveInicial);

    try {
      const usuario = await this.database.transaction(actorUsuarioInterno(sesion.correo), async (tx) => {
        const areaId = await this.areaParaCrear(tx, sesion, gestion, datos);
        const id = await this.usuarios.crear(tx, { nombreCompleto: datos.nombreCompleto, correo: datos.correo, huella, areaId });
        await this.usuarios.asignarRol(tx, id, datos.rol);
        return this.recargar(tx, id);
      });
      return { usuario: aDto(usuario), claveInicial };
    } catch (error) {
      if (esCorreoRepetido(error)) throw new AppError(HttpStatus.CONFLICT, ErrorCode.CORREO_REPETIDO);
      throw traducirErrorDeBase(error);
    }
  }

  async actualizar(sesion: SesionActual, id: string, cambios: CambiosDeUsuario): Promise<UsuarioDto> {
    const gestion = this.exigirGestion(sesion);
    const actor = actorUsuarioInterno(sesion.correo);
    try {
      const usuario = await this.database.transaction(actor, async (tx) => {
        const actual = await this.usuarios.buscarPorId(id, this.alcanceDe(sesion, gestion), tx, true);
        if (!actual) throw noEncontrado();
        await this.aplicarCambios(tx, sesion, gestion, actual, cambios, actor);
        return this.recargar(tx, id);
      });
      return aDto(usuario);
    } catch (error) {
      throw traducirErrorDeBase(error);
    }
  }

  async restablecerClave(sesion: SesionActual, id: string): Promise<UsuarioConClaveDto> {
    const gestion = this.exigirGestion(sesion);
    const claveInicial = generarClaveInicial();
    const huella = await this.hasher.hash(claveInicial);
    try {
      const usuario = await this.database.transaction(actorUsuarioInterno(sesion.correo), async (tx) => {
        const actual = await this.usuarios.buscarPorId(id, this.alcanceDe(sesion, gestion), tx, true);
        if (!actual) throw noEncontrado();
        await this.usuarios.cambiarClave(tx, id, huella);
        await this.usuarios.cerrarSesiones(tx, id);
        return actual;
      });
      return { usuario: aDto(usuario), claveInicial };
    } catch (error) {
      throw traducirErrorDeBase(error);
    }
  }

  private exigirGestion(sesion: SesionActual): GestionDeUsuarios {
    const gestion = gestionDeUsuarios(sesion.roles);
    if (!gestion) throw sinPermiso();
    return gestion;
  }

  private exigirRolAsignable(gestion: GestionDeUsuarios, rol: RolVigente): void {
    if (!gestion.rolesAsignables.includes(rol)) throw sinPermiso(MENSAJE_ROL_NO_ASIGNABLE);
  }

  /** Quien gestiona solo su área ve únicamente los usuarios de ella (y ninguno si no tiene área); el administrador, todos. */
  private alcanceDe(sesion: SesionActual, gestion: GestionDeUsuarios): number | null | undefined {
    return gestion.alcance === AlcanceDeUsuarios.SU_AREA ? (sesion.area?.id ?? null) : undefined;
  }

  /**
   * El área del usuario nuevo. Un responsable de establecimiento siempre crea en la suya, tomada de su sesión (ignora
   * cualquier `area` del cuerpo). El administrador la indica: obligatoria para todo rol salvo el administrador, que no
   * pertenece a ninguna.
   */
  private async areaParaCrear(tx: DbExecutor, sesion: SesionActual, gestion: GestionDeUsuarios, datos: DatosNuevoUsuario): Promise<number | null> {
    if (gestion.alcance === AlcanceDeUsuarios.SU_AREA) {
      if (!sesion.area) throw sinPermiso(MENSAJE_SIN_AREA_PROPIA);
      return sesion.area.id;
    }
    if (datos.rol === RolCodigo.ADMINISTRADOR) {
      if (datos.area) throw noProcesable(MENSAJE_ADMINISTRADOR_SIN_AREA);
      return null;
    }
    if (!datos.area) throw noProcesable(MENSAJE_AREA_OBLIGATORIA);
    return this.areaActivaODe(tx, datos.area);
  }

  private async areaActivaODe(tx: DbExecutor, codigo: string): Promise<number> {
    const areaId = await this.usuarios.areaActiva(codigo, tx);
    if (areaId === null) throw noProcesable(MENSAJE_AREA_INVALIDA);
    return areaId;
  }

  /**
   * Aplica los cambios en un orden que respeta los disparadores de la base: primero se retiran los roles si cambian,
   * luego se mueve el área (que comprueba el tipo contra los roles que queden y el tope del establecimiento) y al final
   * se asigna el rol nuevo. Cambiar el rol cierra las sesiones; mover de área y desactivar ya lo hace la base.
   */
  private async aplicarCambios(
    tx: DbExecutor,
    sesion: SesionActual,
    gestion: GestionDeUsuarios,
    actual: FilaUsuarioGestion,
    cambios: CambiosDeUsuario,
    actor: string,
  ): Promise<void> {
    if (cambios.rol !== undefined) this.exigirRolAsignable(gestion, cambios.rol);
    const esUnoMismo = actual.id === sesion.usuarioId;
    const cambiaRol = cambios.rol !== undefined && cambios.rol !== actual.rol;
    if (esUnoMismo && (cambiaRol || cambios.activo === false)) {
      throw new AppError(HttpStatus.CONFLICT, ErrorCode.AUTOEDICION_NO_PERMITIDA);
    }

    const rolFinal = cambios.rol ?? actual.rol;
    let areaFinal = actual.areaId;
    if (cambios.area !== undefined) {
      if (gestion.alcance !== AlcanceDeUsuarios.TODAS) {
        // Quien solo gestiona su área puede reenviar la que el usuario ya tiene, pero no moverlo.
        if (cambios.area !== actual.areaCodigo) throw sinPermiso(MENSAJE_AREA_NO_PERMITIDA);
      } else if (rolFinal === RolCodigo.ADMINISTRADOR) {
        throw noProcesable(MENSAJE_ADMINISTRADOR_SIN_AREA);
      } else {
        areaFinal = await this.areaActivaODe(tx, cambios.area);
      }
    }
    if (rolFinal === RolCodigo.ADMINISTRADOR) areaFinal = null;
    else if (cambiaRol && areaFinal === null) throw noProcesable(MENSAJE_AREA_OBLIGATORIA);

    if (cambiaRol) await this.usuarios.quitarRoles(tx, actual.id);
    if (areaFinal !== actual.areaId) await this.usuarios.cambiarArea(tx, actual.id, areaFinal);
    if (cambiaRol) {
      await this.usuarios.asignarRol(tx, actual.id, cambios.rol as RolVigente);
      await this.usuarios.cerrarSesiones(tx, actual.id);
    }
    if (cambios.nombreCompleto !== undefined && cambios.nombreCompleto !== actual.nombreCompleto) {
      await this.usuarios.cambiarNombre(tx, actual.id, cambios.nombreCompleto);
    }
    if (cambios.activo !== undefined && cambios.activo !== actual.activo) {
      await this.usuarios.cambiarVigencia(tx, actual.id, cambios.activo, actor);
    }
  }

  private async recargar(tx: DbExecutor, id: string): Promise<FilaUsuarioGestion> {
    const fila = await this.usuarios.buscarPorId(id, undefined, tx);
    if (!fila) throw noEncontrado();
    return fila;
  }
}
