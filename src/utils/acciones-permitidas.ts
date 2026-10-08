import { PERMISOS_POR_ROL, type PermisosDelRol, type ReglaDeAccion } from "@/constants/permisos-por-rol.js";
import { ACCIONES_EN_ORDEN } from "@/constants/incidencias.js";
import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import type { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";

export interface CasoParaAcciones {
  estado: EstadoIncidencia;
  categoria: CategoriaIncidencia | null;
  revisada: boolean;
}

type TablaDePermisos = Readonly<Record<string, PermisosDelRol>>;

const TODAS_LAS_CATEGORIAS: readonly CategoriaIncidencia[] = Object.values(CategoriaIncidencia);

function cumple(regla: ReglaDeAccion, caso: CasoParaAcciones): boolean {
  if (!regla.estados.includes(caso.estado)) return false;
  if (regla.categorias && (caso.categoria === null || !regla.categorias.includes(caso.categoria))) return false;
  if (regla.revisada !== undefined && regla.revisada !== caso.revisada) return false;
  return true;
}

/**
 * Une las acciones que dan todos los roles dados sobre este caso, sin repetir y en el orden confirmar,
 * corregir, derivar, tomar, resolver, archivar y reabrir. Ignora los roles que la tabla no conoce (DIRIS desactivado, uno
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
 * A qué categorías puede cambiar un caso quien lo corrige: la unión de las que permiten las reglas de `corregir`
 * que cumplen todos sus roles sobre este caso. Una regla sin `categoriasDestino` permite cualquiera. Vacío si no
 * puede corregirlo.
 */
export function categoriasParaCorregir(
  roles: readonly string[],
  caso: CasoParaAcciones,
  permisos: TablaDePermisos = PERMISOS_POR_ROL,
): CategoriaIncidencia[] {
  const permitidas = new Set<CategoriaIncidencia>();
  for (const rol of roles) {
    if (!Object.hasOwn(permisos, rol)) continue;
    for (const regla of (permisos[rol] as PermisosDelRol).acciones) {
      if (regla.accion !== AccionIncidencia.CORREGIR || !cumple(regla, caso)) continue;
      for (const categoria of regla.categoriasDestino ?? TODAS_LAS_CATEGORIAS) permitidas.add(categoria);
    }
  }
  return [...permitidas];
}

/**
 * Qué reglas de acción definen lo que a una persona le toca atender (lo que cuenta su campana de avisos): las de
 * todos sus roles. Quien tiene algún rol que cuenta todo lo abierto (el administrador) devuelve `null`: cuenta
 * todos los casos abiertos que ve. Sin roles que la tabla conozca no hay nada pendiente.
 */
export function reglasDeAvisos(roles: readonly string[], permisos: TablaDePermisos = PERMISOS_POR_ROL): readonly ReglaDeAccion[] | null {
  const reglas: ReglaDeAccion[] = [];
  for (const rol of roles) {
    if (!Object.hasOwn(permisos, rol)) continue;
    const { acciones, avisaTodoLoAbierto } = permisos[rol] as PermisosDelRol;
    if (avisaTodoLoAbierto) return null;
    reglas.push(...acciones);
  }
  return reglas;
}

/** Si alguno de los roles puede listar todas las áreas; si no, la persona solo ve la suya. Ignora los roles desconocidos. */
export function veTodasLasAreas(roles: readonly string[], permisos: TablaDePermisos = PERMISOS_POR_ROL): boolean {
  return roles.some((rol) => Object.hasOwn(permisos, rol) && (permisos[rol] as PermisosDelRol).veTodasLasAreas);
}

export function veCasosSinCategoria(roles: readonly string[], permisos: TablaDePermisos = PERMISOS_POR_ROL): boolean {
  return roles.some((rol) => Object.hasOwn(permisos, rol) && (permisos[rol] as PermisosDelRol).veSinCategoria);
}
