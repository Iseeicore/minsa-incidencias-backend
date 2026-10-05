import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";

export type RolVigente = Exclude<RolCodigo, typeof RolCodigo.REVISOR>;

export interface PermisosDelRol {
  vistas: readonly VistaCodigo[];
}

const TODAS_LAS_VISTAS: readonly VistaCodigo[] = Object.values(VistaCodigo);

/**
 * Qué puede abrir cada rol en el MVP: una tabla fija, sin permisos editables. El revisor está retirado
 * (su función pasó al gestor) y por eso no figura. Las reglas de acciones por rol se agregan aquí,
 * como un campo más de `PermisosDelRol`.
 */
export const PERMISOS_POR_ROL: Readonly<Record<RolVigente, PermisosDelRol>> = {
  [RolCodigo.ADMINISTRADOR]: { vistas: TODAS_LAS_VISTAS },
  [RolCodigo.GESTOR]: { vistas: TODAS_LAS_VISTAS },
  [RolCodigo.AREA_DENUNCIA_CORRUPCION]: { vistas: TODAS_LAS_VISTAS },
  [RolCodigo.AREA_QUEJA]: { vistas: TODAS_LAS_VISTAS },
  [RolCodigo.AREA_RECLAMO]: { vistas: TODAS_LAS_VISTAS },
};
