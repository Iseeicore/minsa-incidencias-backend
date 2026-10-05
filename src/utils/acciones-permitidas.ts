import { PERMISOS_POR_ROL, type PermisosDelRol, type ReglaDeAccion } from "@/constants/permisos-por-rol.js";
import { ACCIONES_EN_ORDEN, CATEGORIAS_CON_AREA } from "@/constants/incidencias.js";
import type { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import type { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";

export interface CasoParaAcciones {
  estado: EstadoIncidencia;
  categoria: CategoriaIncidencia | null;
  revisada: boolean;
}

type TablaDePermisos = Readonly<Record<string, PermisosDelRol>>;

function cumple(regla: ReglaDeAccion, caso: CasoParaAcciones): boolean {
  if (!regla.estados.includes(caso.estado)) return false;
  if (regla.categorias && (caso.categoria === null || !regla.categorias.includes(caso.categoria))) return false;
  if (regla.revisada !== undefined && regla.revisada !== caso.revisada) return false;
  if (regla.requiereArea && (caso.categoria === null || !CATEGORIAS_CON_AREA.includes(caso.categoria))) return false;
  return true;
}

/**
 * Une las acciones que dan todos los roles dados sobre este caso, sin repetir y en el orden confirmar,
 * corregir, derivar, tomar y resolver. Ignora los roles que la tabla no conoce (el revisor retirado, uno
 * inventado o nombres heredados del objeto).
 */
export function accionesPermitidas(
  roles: readonly string[],
  caso: CasoParaAcciones,
  permisos: TablaDePermisos = PERMISOS_POR_ROL,
): AccionIncidencia[] {
  const habilitadas = new Set<AccionIncidencia>();
  for (const rol of roles) {
    if (!Object.hasOwn(permisos, rol)) continue;
    for (const regla of (permisos[rol] as PermisosDelRol).acciones) {
      if (cumple(regla, caso)) habilitadas.add(regla.accion);
    }
  }
  return ACCIONES_EN_ORDEN.filter((accion) => habilitadas.has(accion));
}

/**
 * Qué reglas de acción definen lo que a una persona le toca atender (lo que cuenta su campana de avisos): las de
 * todos sus roles. Quien tiene algún rol que no actúa sobre los casos (el administrador) devuelve `null`: cuenta
 * todos los casos abiertos que ve. Sin roles que la tabla conozca no hay nada pendiente.
 */
export function reglasDeAvisos(roles: readonly string[], permisos: TablaDePermisos = PERMISOS_POR_ROL): readonly ReglaDeAccion[] | null {
  const reglas: ReglaDeAccion[] = [];
  for (const rol of roles) {
    if (!Object.hasOwn(permisos, rol)) continue;
    const acciones = (permisos[rol] as PermisosDelRol).acciones;
    if (acciones.length === 0) return null;
    reglas.push(...acciones);
  }
  return reglas;
}

export function veCasosSinCategoria(roles: readonly string[], permisos: TablaDePermisos = PERMISOS_POR_ROL): boolean {
  return roles.some((rol) => Object.hasOwn(permisos, rol) && (permisos[rol] as PermisosDelRol).veSinCategoria);
}
