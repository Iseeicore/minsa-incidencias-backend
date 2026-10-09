import type { RolVigente } from "@/constants/permisos-por-rol.js";
import type { PosicionDeUsuarios } from "@/utils/cursor-usuarios.js";
import type { SesionActual } from "./auth.types.js";

export interface ConsultaUsuarios {
  limite: number;
  /** Posición del cursor de `siguiente`, ya decodificada; ausente en la primera página. */
  despuesDe?: PosicionDeUsuarios;
  /** Texto sin tildes ni mayúsculas sobre el nombre o el correo. */
  texto?: string;
  /** Código del área. Solo lo respeta quien ve todas las áreas; un establecimiento siempre ve la suya. */
  area?: string;
}

export interface DatosNuevoUsuario {
  nombreCompleto: string;
  /** Ya normalizado: sin espacios y en minúsculas. */
  correo: string;
  rol: RolVigente;
  /** Código del área. Quien gestiona solo su establecimiento no lo elige: se toma de su sesión y esto se ignora. */
  area?: string;
}

export interface CambiosDeUsuario {
  nombreCompleto?: string;
  rol?: RolVigente;
  activo?: boolean;
  /** Código del área. Solo la cambia quien ve todas las áreas. */
  area?: string;
}

export interface UsuarioDto {
  id: string;
  nombreCompleto: string;
  correo: string;
  /** El rol del usuario; `null` si no tiene ninguno activo. */
  rol: string | null;
  activo: boolean;
  area: { codigo: string; nombre: string } | null;
}

export interface ListaUsuariosDto {
  items: UsuarioDto[];
  /** Cursor para pedir la página que sigue; `null` en la última. */
  siguiente: string | null;
  hayMas: boolean;
}

/** Quien crea o restablece recibe la clave inicial una sola vez; no se puede volver a consultar. */
export interface UsuarioConClaveDto {
  usuario: UsuarioDto;
  claveInicial: string;
}

export interface UsuarioServicio {
  listar(sesion: SesionActual, consulta: ConsultaUsuarios): Promise<ListaUsuariosDto>;
  crear(sesion: SesionActual, datos: DatosNuevoUsuario): Promise<UsuarioConClaveDto>;
  actualizar(sesion: SesionActual, id: string, cambios: CambiosDeUsuario): Promise<UsuarioDto>;
  restablecerClave(sesion: SesionActual, id: string): Promise<UsuarioConClaveDto>;
}
