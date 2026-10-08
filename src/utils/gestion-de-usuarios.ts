import {
  AlcanceDeUsuarios,
  PERMISOS_POR_ROL,
  type GestionDeUsuarios,
  type PermisosDelRol,
  type RolVigente,
} from "@/constants/permisos-por-rol.js";

type TablaDePermisos = Readonly<Record<string, PermisosDelRol>>;

/**
 * Qué puede hacer una persona con los usuarios: la unión de lo que dan todos sus roles. El alcance más amplio gana
 * (todas las áreas sobre solo la suya) y los roles asignables se juntan. `null` si ninguno de sus roles gestiona
 * usuarios. Ignora los roles que la tabla no conoce (DIRIS desactivado, uno inventado o nombres heredados del objeto).
 */
export function gestionDeUsuarios(roles: readonly string[], permisos: TablaDePermisos = PERMISOS_POR_ROL): GestionDeUsuarios | null {
  let alcance: AlcanceDeUsuarios | null = null;
  const asignables = new Set<RolVigente>();
  for (const rol of roles) {
    if (!Object.hasOwn(permisos, rol)) continue;
    const gestion = (permisos[rol] as PermisosDelRol).usuarios;
    if (!gestion) continue;
    if (alcance === null || gestion.alcance === AlcanceDeUsuarios.TODAS) alcance = gestion.alcance;
    for (const asignable of gestion.rolesAsignables) asignables.add(asignable);
  }
  return alcance === null ? null : { alcance, rolesAsignables: [...asignables] };
}
