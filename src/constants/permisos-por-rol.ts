import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";

export type RolVigente = Exclude<RolCodigo, typeof RolCodigo.DIRIS>;

export interface ReglaDeAccion {
  accion: AccionIncidencia;
  estados: readonly EstadoIncidencia[];
  categorias?: readonly CategoriaIncidencia[];
  revisada?: boolean;
}

export interface PermisosDelRol {
  vistas: readonly VistaCodigo[];
  veSinCategoria: boolean;
  /** Si puede listar todas las áreas (`GET /areas`, para elegir el destino); si no, solo ve la suya. */
  veTodasLasAreas: boolean;
  acciones: readonly ReglaDeAccion[];
}

const TODAS_LAS_VISTAS: readonly VistaCodigo[] = Object.values(VistaCodigo);
const VISTAS_SIN_DERIVACIONES: readonly VistaCodigo[] = TODAS_LAS_VISTAS.filter((vista) => vista !== VistaCodigo.DERIVACIONES);

const { CLASIFICADO, DERIVADO, EN_GESTION } = EstadoIncidencia;
const { DENUNCIA_CORRUPCION, QUEJA, RECLAMO, OTRO } = CategoriaIncidencia;
const { CONFIRMAR, CORREGIR, DERIVAR, TOMAR, RESOLVER } = AccionIncidencia;

const CATEGORIAS_DEL_GESTOR: readonly CategoriaIncidencia[] = [QUEJA, RECLAMO, OTRO];
const CATEGORIAS_PARA_DERIVAR: readonly CategoriaIncidencia[] = [QUEJA, RECLAMO];

/**
 * Qué puede abrir y hacer cada rol en el MVP: una tabla fija, sin permisos editables. Qué categorías ve cada
 * rol lo decide la base (`gestion.rol_categoria`) y, para los roles ligados a un área (OTRANS y establecimiento),
 * que el caso esté destinado a su área; aquí solo se dice si ve los casos aún sin categoría y qué acciones puede
 * ejecutar según el estado, la revisión y la categoría. El rol DIRIS está desactivado y por eso no figura. El
 * administrador solo mira: no actúa sobre los casos. Derivar elige el área de destino (por defecto, la del
 * establecimiento de origen) y la deriva siempre un gestor; por eso el gestor lista todas las áreas para elegirla,
 * y el administrador también (las ve para filtrar por establecimiento). OTRANS y los establecimientos solo ven
 * su propia área: no derivan y no necesitan conocer las demás.
 */
export const PERMISOS_POR_ROL: Readonly<Record<RolVigente, PermisosDelRol>> = {
  [RolCodigo.ADMINISTRADOR]: { vistas: TODAS_LAS_VISTAS, veSinCategoria: true, veTodasLasAreas: true, acciones: [] },
  [RolCodigo.GESTOR]: {
    vistas: TODAS_LAS_VISTAS,
    veSinCategoria: true,
    veTodasLasAreas: true,
    acciones: [
      { accion: CONFIRMAR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_GESTOR, revisada: false },
      { accion: CORREGIR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_GESTOR, revisada: false },
      { accion: DERIVAR, estados: [CLASIFICADO], categorias: CATEGORIAS_PARA_DERIVAR, revisada: true },
    ],
  },
  [RolCodigo.OTRANS]: {
    vistas: VISTAS_SIN_DERIVACIONES,
    veSinCategoria: false,
    veTodasLasAreas: false,
    acciones: [
      { accion: CONFIRMAR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: false },
      { accion: CORREGIR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: false },
      { accion: TOMAR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: true },
      { accion: TOMAR, estados: [DERIVADO], categorias: [DENUNCIA_CORRUPCION] },
      { accion: RESOLVER, estados: [DERIVADO, EN_GESTION], categorias: [DENUNCIA_CORRUPCION] },
    ],
  },
  [RolCodigo.ESTABLECIMIENTO]: {
    vistas: VISTAS_SIN_DERIVACIONES,
    veSinCategoria: false,
    veTodasLasAreas: false,
    acciones: [
      { accion: TOMAR, estados: [DERIVADO], categorias: CATEGORIAS_PARA_DERIVAR },
      { accion: RESOLVER, estados: [DERIVADO, EN_GESTION], categorias: CATEGORIAS_PARA_DERIVAR },
    ],
  },
};
