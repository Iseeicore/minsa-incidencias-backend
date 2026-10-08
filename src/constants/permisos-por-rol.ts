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
  /** Solo en `corregir`: a qué categorías puede cambiar el caso quien corrige. Sin él, a cualquiera. */
  categoriasDestino?: readonly CategoriaIncidencia[];
}

/** Hasta dónde llega quien gestiona usuarios: todas las áreas, o solo la suya. */
export const AlcanceDeUsuarios = {
  TODAS: "todas",
  SU_AREA: "su-area",
} as const;
export type AlcanceDeUsuarios = (typeof AlcanceDeUsuarios)[keyof typeof AlcanceDeUsuarios];

export interface GestionDeUsuarios {
  alcance: AlcanceDeUsuarios;
  /** Qué roles puede asignar al crear o cambiar un usuario. */
  rolesAsignables: readonly RolVigente[];
}

export interface PermisosDelRol {
  vistas: readonly VistaCodigo[];
  /** Si crea, edita y desactiva usuarios (vista `USUARIOS`); `null` si no gestiona usuarios. */
  usuarios: GestionDeUsuarios | null;
  veSinCategoria: boolean;
  /** Si puede listar todas las áreas (`GET /areas`, para filtrar por establecimiento o elegir el destino); si no, solo ve la suya. */
  veTodasLasAreas: boolean;
  /** Si su campana cuenta todos los casos abiertos que ve, en vez de solo los que le toca atender según sus acciones. */
  avisaTodoLoAbierto: boolean;
  acciones: readonly ReglaDeAccion[];
}

const TODAS_LAS_VISTAS: readonly VistaCodigo[] = Object.values(VistaCodigo);
const sin = (...excluidas: readonly VistaCodigo[]): readonly VistaCodigo[] => TODAS_LAS_VISTAS.filter((vista) => !excluidas.includes(vista));
/**
 * `QR` (generador de códigos QR de WhatsApp por establecimiento) solo la tienen el administrador y los establecimientos;
 * `USUARIOS` (gestión de usuarios) también: solo quien puede crear usuarios la abre.
 */
const VISTAS_DEL_GESTOR = sin(VistaCodigo.QR, VistaCodigo.USUARIOS);
const VISTAS_DE_OTRANS = sin(VistaCodigo.DERIVACIONES, VistaCodigo.QR, VistaCodigo.USUARIOS);
const VISTAS_DEL_ESTABLECIMIENTO = sin(VistaCodigo.DERIVACIONES);

const { CLASIFICADO, DERIVADO, EN_GESTION, ARCHIVADO } = EstadoIncidencia;
const { DENUNCIA_CORRUPCION, QUEJA, RECLAMO, OTRO } = CategoriaIncidencia;
const { CONFIRMAR, CORREGIR, DERIVAR, TOMAR, RESOLVER, ARCHIVAR, REABRIR } = AccionIncidencia;

const CATEGORIAS_DEL_AREA: readonly CategoriaIncidencia[] = [QUEJA, RECLAMO, OTRO];
const ESTADOS_ARCHIVABLES: readonly EstadoIncidencia[] = [CLASIFICADO, DERIVADO, EN_GESTION];

/** Lo que hacen sobre los casos de su propia área el responsable del establecimiento y el gestor: revisar, atender, archivar y reabrir. */
const ACCIONES_DE_REVISION_EN_EL_AREA: readonly ReglaDeAccion[] = [
  { accion: CONFIRMAR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_AREA, revisada: false },
  { accion: CORREGIR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_AREA, revisada: false, categoriasDestino: CATEGORIAS_DEL_AREA },
  { accion: TOMAR, estados: [CLASIFICADO], categorias: CATEGORIAS_DEL_AREA, revisada: true },
  { accion: TOMAR, estados: [DERIVADO], categorias: CATEGORIAS_DEL_AREA },
  { accion: RESOLVER, estados: [EN_GESTION, DERIVADO], categorias: CATEGORIAS_DEL_AREA },
  { accion: ARCHIVAR, estados: ESTADOS_ARCHIVABLES, categorias: CATEGORIAS_DEL_AREA },
  { accion: REABRIR, estados: [ARCHIVADO], categorias: CATEGORIAS_DEL_AREA },
];

/**
 * Qué puede abrir y hacer cada rol en el MVP: una tabla fija, sin permisos editables. Qué categorías ve cada
 * rol lo decide la base (`gestion.rol_categoria`) y, para los roles ligados a un área (gestor, OTRANS y establecimiento),
 * que el caso esté destinado a su área; aquí solo se dice si ve los casos aún sin categoría y qué acciones puede
 * ejecutar según el estado, la revisión y la categoría. El rol DIRIS está desactivado y por eso no figura.
 *
 * La revisión ocurre donde llega el caso: el responsable del establecimiento y el gestor (que pertenece siempre a un
 * establecimiento) confirman, corrigen, toman, resuelven, archivan y reabren los casos de su área, y OTRANS hace lo
 * mismo con la corrupción. No derivan: derivar (cambiar el área de destino) solo lo hacen OTRANS y el administrador. El
 * administrador revisa, deriva, archiva y reabre cualquier caso, pero no toma ni resuelve: ese trabajo lo hace el área.
 * Solo el administrador lista todas las áreas; los demás roles ven la suya.
 *
 * Usuarios: el administrador crea y gestiona los de cualquier área y asigna cualquier rol; el responsable del
 * establecimiento, solo los de su propio establecimiento y solo los roles GESTOR o ESTABLECIMIENTO (nunca
 * ADMINISTRADOR ni OTRANS). El gestor y OTRANS no gestionan usuarios.
 */
export const PERMISOS_POR_ROL: Readonly<Record<RolVigente, PermisosDelRol>> = {
  [RolCodigo.ADMINISTRADOR]: {
    vistas: TODAS_LAS_VISTAS,
    usuarios: {
      alcance: AlcanceDeUsuarios.TODAS,
      rolesAsignables: [RolCodigo.ADMINISTRADOR, RolCodigo.GESTOR, RolCodigo.OTRANS, RolCodigo.ESTABLECIMIENTO],
    },
    veSinCategoria: true,
    veTodasLasAreas: true,
    avisaTodoLoAbierto: true,
    acciones: [
      { accion: CONFIRMAR, estados: [CLASIFICADO], revisada: false },
      { accion: CORREGIR, estados: [CLASIFICADO], revisada: false },
      { accion: DERIVAR, estados: [CLASIFICADO], revisada: true },
      { accion: ARCHIVAR, estados: ESTADOS_ARCHIVABLES },
      { accion: REABRIR, estados: [ARCHIVADO] },
    ],
  },
  [RolCodigo.GESTOR]: {
    vistas: VISTAS_DEL_GESTOR,
    usuarios: null,
    veSinCategoria: false,
    veTodasLasAreas: false,
    avisaTodoLoAbierto: false,
    acciones: ACCIONES_DE_REVISION_EN_EL_AREA,
  },
  [RolCodigo.OTRANS]: {
    vistas: VISTAS_DE_OTRANS,
    usuarios: null,
    veSinCategoria: false,
    veTodasLasAreas: false,
    avisaTodoLoAbierto: false,
    acciones: [
      { accion: CONFIRMAR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: false },
      { accion: CORREGIR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: false },
      { accion: DERIVAR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: true },
      { accion: TOMAR, estados: [CLASIFICADO], categorias: [DENUNCIA_CORRUPCION], revisada: true },
      { accion: TOMAR, estados: [DERIVADO], categorias: [DENUNCIA_CORRUPCION] },
      { accion: RESOLVER, estados: [DERIVADO, EN_GESTION], categorias: [DENUNCIA_CORRUPCION] },
      { accion: ARCHIVAR, estados: ESTADOS_ARCHIVABLES, categorias: [DENUNCIA_CORRUPCION] },
      { accion: REABRIR, estados: [ARCHIVADO], categorias: [DENUNCIA_CORRUPCION] },
    ],
  },
  [RolCodigo.ESTABLECIMIENTO]: {
    vistas: VISTAS_DEL_ESTABLECIMIENTO,
    usuarios: { alcance: AlcanceDeUsuarios.SU_AREA, rolesAsignables: [RolCodigo.GESTOR, RolCodigo.ESTABLECIMIENTO] },
    veSinCategoria: false,
    veTodasLasAreas: false,
    avisaTodoLoAbierto: false,
    acciones: ACCIONES_DE_REVISION_EN_EL_AREA,
  },
};
