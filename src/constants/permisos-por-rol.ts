import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";

export type RolVigente = Exclude<RolCodigo, typeof RolCodigo.REVISOR>;

export interface ReglaDeAccion {
  accion: AccionIncidencia;
  estados: readonly EstadoIncidencia[];
  categorias?: readonly CategoriaIncidencia[];
  revisada?: boolean;
  requiereArea?: boolean;
}

export interface PermisosDelRol {
  vistas: readonly VistaCodigo[];
  veSinCategoria: boolean;
  acciones: readonly ReglaDeAccion[];
}

const TODAS_LAS_VISTAS: readonly VistaCodigo[] = Object.values(VistaCodigo);

const { CLASIFICADO, DERIVADO, EN_GESTION } = EstadoIncidencia;
const { DENUNCIA_CORRUPCION, QUEJA, RECLAMO, OTRO } = CategoriaIncidencia;
const { CONFIRMAR, CORREGIR, DERIVAR, TOMAR, RESOLVER } = AccionIncidencia;

const CATEGORIAS_DEL_GESTOR: readonly CategoriaIncidencia[] = [QUEJA, RECLAMO, OTRO];

/** Lo que hace un área sobre lo que le derivan, limitado a su propia categoría. */
const atencionDelArea = (categoria: CategoriaIncidencia): readonly ReglaDeAccion[] => [
  { accion: TOMAR, estados: [DERIVADO], categorias: [categoria] },
  { accion: RESOLVER, estados: [DERIVADO, EN_GESTION], categorias: [categoria] },
];

/**
 * Qué puede abrir y hacer cada rol en el MVP: una tabla fija, sin permisos editables. Qué categorías ve cada
 * rol lo decide la base (`gestion.rol_categoria`); aquí solo se dice si ve los casos aún sin categoría y qué
 * acciones puede ejecutar según el estado, la revisión y la categoría. El revisor está retirado (su función
 * pasó al gestor) y por eso no figura. El administrador solo mira: no actúa sobre los casos.
 */
export const PERMISOS_POR_ROL: Readonly<Record<RolVigente, PermisosDelRol>> = {
  [RolCodigo.ADMINISTRADOR]: { vistas: TODAS_LAS_VISTAS, veSinCategoria: true, acciones: [] },
  [RolCodigo.GESTOR]: {
    vistas: TODAS_LAS_VISTAS,
    veSinCategoria: true,
    acciones: [
      { accion: CONFIRMAR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_GESTOR, revisada: false },
      { accion: CORREGIR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_GESTOR, revisada: false },
      { accion: DERIVAR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_GESTOR, revisada: true, requiereArea: true },
    ],
  },
  [RolCodigo.AREA_DENUNCIA_CORRUPCION]: {
    vistas: TODAS_LAS_VISTAS,
    veSinCategoria: false,
    acciones: [
      { accion: CONFIRMAR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: false },
      { accion: CORREGIR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: false },
      { accion: TOMAR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: true },
      ...atencionDelArea(DENUNCIA_CORRUPCION),
    ],
  },
  [RolCodigo.AREA_QUEJA]: { vistas: TODAS_LAS_VISTAS, veSinCategoria: false, acciones: atencionDelArea(QUEJA) },
  [RolCodigo.AREA_RECLAMO]: { vistas: TODAS_LAS_VISTAS, veSinCategoria: false, acciones: atencionDelArea(RECLAMO) },
};
