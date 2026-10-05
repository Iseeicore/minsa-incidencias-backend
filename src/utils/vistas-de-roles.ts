import { PERMISOS_POR_ROL, type PermisosDelRol } from "@/constants/permisos-por-rol.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";

const ORDEN_DEL_MENU: readonly VistaCodigo[] = Object.values(VistaCodigo);

/**
 * Une las vistas de todos los roles dados, sin repetir y en el orden del menú. Ignora los roles que la
 * tabla no conoce (el revisor retirado, uno inventado o nombres heredados del objeto).
 */
export function vistasDeRoles(
  roles: readonly string[],
  permisos: Readonly<Record<string, PermisosDelRol>> = PERMISOS_POR_ROL,
): VistaCodigo[] {
  const habilitadas = new Set<VistaCodigo>();
  for (const rol of roles) {
    if (!Object.hasOwn(permisos, rol)) continue;
    for (const vista of (permisos[rol] as PermisosDelRol).vistas) habilitadas.add(vista);
  }
  return ORDEN_DEL_MENU.filter((vista) => habilitadas.has(vista));
}
