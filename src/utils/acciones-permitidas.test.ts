import { describe, expect, it } from "vitest";
import { PERMISOS_POR_ROL } from "@/constants/permisos-por-rol.js";
import { AccionIncidencia as A } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia as C } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia as E } from "@/enums/estado-incidencia.enum.js";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { accionesPermitidas, categoriasParaCorregir, reglasDeAvisos, veTodasLasAreas } from "@/utils/acciones-permitidas.js";

type Caso = Parameters<typeof accionesPermitidas>[1];
const caso = (estado: E, categoria: C | null, revisada: boolean): Caso => ({ estado, categoria, revisada });

type Fila = [string, readonly string[], E, C | null, boolean, A[]];

/** Lo que hacen el responsable del establecimiento y el gestor sobre los casos de su área que no son corrupción; solo el gestor deriva. */
const delArea = (rol: string, deriva: boolean): Fila[] => [
  [`${rol}: confirma, corrige o archiva una queja sin revisar`, [rol], E.CLASIFICADO, C.QUEJA, false, [A.CONFIRMAR, A.CORREGIR, A.ARCHIVAR]],
  [`${rol}: confirma, corrige o archiva un reclamo sin revisar`, [rol], E.CLASIFICADO, C.RECLAMO, false, [A.CONFIRMAR, A.CORREGIR, A.ARCHIVAR]],
  [`${rol}: confirma, corrige o archiva un caso otro sin revisar`, [rol], E.CLASIFICADO, C.OTRO, false, [A.CONFIRMAR, A.CORREGIR, A.ARCHIVAR]],
  [`${rol}: toma directo o archiva una queja revisada${deriva ? ", la deriva" : ", sin derivar"}`, [rol], E.CLASIFICADO, C.QUEJA, true, deriva ? [A.DERIVAR, A.TOMAR, A.ARCHIVAR] : [A.TOMAR, A.ARCHIVAR]],
  [`${rol}: toma directo o archiva un caso otro revisado`, [rol], E.CLASIFICADO, C.OTRO, true, deriva ? [A.DERIVAR, A.TOMAR, A.ARCHIVAR] : [A.TOMAR, A.ARCHIVAR]],
  [`${rol}: toma, resuelve o archiva un reclamo derivado`, [rol], E.DERIVADO, C.RECLAMO, true, [A.TOMAR, A.RESOLVER, A.ARCHIVAR]],
  [`${rol}: resuelve o archiva una queja en gestión`, [rol], E.EN_GESTION, C.QUEJA, true, [A.RESOLVER, A.ARCHIVAR]],
  [`${rol}: no actúa sobre un caso resuelto`, [rol], E.RESUELTO, C.QUEJA, true, []],
  [`${rol}: reabre un reclamo archivado`, [rol], E.ARCHIVADO, C.RECLAMO, true, [A.REABRIR]],
  [`${rol}: no actúa sobre corrupción clasificada`, [rol], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, false, []],
  [`${rol}: no actúa sobre corrupción en gestión`, [rol], E.EN_GESTION, C.DENUNCIA_CORRUPCION, true, []],
  [`${rol}: no reabre un archivado de corrupción`, [rol], E.ARCHIVADO, C.DENUNCIA_CORRUPCION, true, []],
  [`${rol}: no actúa sobre un caso sin categoría`, [rol], E.REGISTRADO, null, false, []],
];

const MATRIZ: Fila[] = [
  ...delArea(R.ESTABLECIMIENTO, false),
  ...delArea(R.GESTOR, true),

  ["OTRANS: confirma, corrige o archiva sin revisar", [R.OTRANS], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, false, [A.CONFIRMAR, A.CORREGIR, A.ARCHIVAR]],
  ["OTRANS: deriva, toma directo o archiva lo revisado", [R.OTRANS], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, true, [A.DERIVAR, A.TOMAR, A.ARCHIVAR]],
  ["OTRANS: toma, resuelve o archiva lo derivado", [R.OTRANS], E.DERIVADO, C.DENUNCIA_CORRUPCION, true, [A.TOMAR, A.RESOLVER, A.ARCHIVAR]],
  ["OTRANS: resuelve o archiva lo que está en gestión", [R.OTRANS], E.EN_GESTION, C.DENUNCIA_CORRUPCION, true, [A.RESOLVER, A.ARCHIVAR]],
  ["OTRANS: no actúa en RESUELTO", [R.OTRANS], E.RESUELTO, C.DENUNCIA_CORRUPCION, true, []],
  ["OTRANS: reabre un archivado de corrupción", [R.OTRANS], E.ARCHIVADO, C.DENUNCIA_CORRUPCION, true, [A.REABRIR]],
  ["OTRANS: no actúa sobre una queja", [R.OTRANS], E.CLASIFICADO, C.QUEJA, false, []],
  ["OTRANS: no reabre una queja archivada", [R.OTRANS], E.ARCHIVADO, C.QUEJA, true, []],

  ["administrador: confirma, corrige o archiva una queja sin revisar", [R.ADMINISTRADOR], E.CLASIFICADO, C.QUEJA, false, [A.CONFIRMAR, A.CORREGIR, A.ARCHIVAR]],
  ["administrador: confirma, corrige o archiva corrupción sin revisar", [R.ADMINISTRADOR], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, false, [A.CONFIRMAR, A.CORREGIR, A.ARCHIVAR]],
  ["administrador: deriva o archiva una queja revisada", [R.ADMINISTRADOR], E.CLASIFICADO, C.QUEJA, true, [A.DERIVAR, A.ARCHIVAR]],
  ["administrador: deriva o archiva un caso otro revisado", [R.ADMINISTRADOR], E.CLASIFICADO, C.OTRO, true, [A.DERIVAR, A.ARCHIVAR]],
  ["administrador: deriva o archiva corrupción revisada", [R.ADMINISTRADOR], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, true, [A.DERIVAR, A.ARCHIVAR]],
  ["administrador: solo archiva lo derivado (no toma ni resuelve)", [R.ADMINISTRADOR], E.DERIVADO, C.QUEJA, true, [A.ARCHIVAR]],
  ["administrador: solo archiva lo que está en gestión", [R.ADMINISTRADOR], E.EN_GESTION, C.DENUNCIA_CORRUPCION, true, [A.ARCHIVAR]],
  ["administrador: no actúa en RESUELTO", [R.ADMINISTRADOR], E.RESUELTO, C.QUEJA, true, []],
  ["administrador: reabre un archivado de queja", [R.ADMINISTRADOR], E.ARCHIVADO, C.QUEJA, true, [A.REABRIR]],
  ["administrador: reabre un archivado de corrupción", [R.ADMINISTRADOR], E.ARCHIVADO, C.DENUNCIA_CORRUPCION, true, [A.REABRIR]],
  ["administrador: no actúa sobre un caso sin categoría", [R.ADMINISTRADOR], E.REGISTRADO, null, false, []],

  ["establecimiento y gestor juntos no suman nada más", [R.GESTOR, R.ESTABLECIMIENTO], E.DERIVADO, C.QUEJA, true, [A.TOMAR, A.RESOLVER, A.ARCHIVAR]],
  ["gestor y OTRANS: lo revisado de corrupción lo deriva, toma o archiva", [R.GESTOR, R.OTRANS], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, true, [A.DERIVAR, A.TOMAR, A.ARCHIVAR]],
  ["administrador y establecimiento: una queja derivada se toma, resuelve o archiva", [R.ADMINISTRADOR, R.ESTABLECIMIENTO], E.DERIVADO, C.QUEJA, true, [A.TOMAR, A.RESOLVER, A.ARCHIVAR]],
  ["administrador y establecimiento: una queja revisada se deriva, toma o archiva", [R.ADMINISTRADOR, R.ESTABLECIMIENTO], E.CLASIFICADO, C.QUEJA, true, [A.DERIVAR, A.TOMAR, A.ARCHIVAR]],

  ["DIRIS (desactivado) no da acciones", [R.DIRIS], E.DERIVADO, C.QUEJA, true, []],
  ["un rol inventado no da acciones", ["INVENTADO"], E.CLASIFICADO, C.QUEJA, false, []],
  ["un nombre heredado del objeto no da acciones", ["constructor"], E.CLASIFICADO, C.QUEJA, false, []],
  ["sin roles no hay acciones", [], E.CLASIFICADO, C.QUEJA, false, []],
];

describe("accionesPermitidas", () => {
  it.each(MATRIZ)("%s", (_nombre, roles, estado, categoria, revisada, esperadas) => {
    expect(accionesPermitidas(roles, caso(estado, categoria, revisada))).toEqual(esperadas);
  });

  it("devuelve las acciones en el orden confirmar, corregir, derivar, tomar, resolver, archivar y reabrir, sin repetir", () => {
    const acciones = accionesPermitidas([R.OTRANS, R.OTRANS, R.ADMINISTRADOR], caso(E.CLASIFICADO, C.DENUNCIA_CORRUPCION, true));
    expect(acciones).toEqual([A.DERIVAR, A.TOMAR, A.ARCHIVAR]);
  });

  it("el gestor tiene las acciones del responsable del establecimiento más derivar", () => {
    const delGestor = PERMISOS_POR_ROL[R.GESTOR].acciones;
    expect(delGestor.filter((regla) => regla.accion !== A.DERIVAR)).toEqual(PERMISOS_POR_ROL[R.ESTABLECIMIENTO].acciones);
    expect(delGestor.filter((regla) => regla.accion === A.DERIVAR)).toEqual([
      { accion: A.DERIVAR, estados: [E.CLASIFICADO], categorias: [C.QUEJA, C.RECLAMO, C.OTRO], revisada: true },
    ]);
  });

  it("derivan OTRANS, el administrador y el gestor (este solo queja, reclamo u otro), nunca el establecimiento ni corrupción desde el área", () => {
    const quienDeriva = Object.entries(PERMISOS_POR_ROL)
      .filter(([, permisos]) => permisos.acciones.some((regla) => regla.accion === A.DERIVAR))
      .map(([rol]) => rol)
      .sort();
    expect(quienDeriva).toEqual([R.ADMINISTRADOR, R.GESTOR, R.OTRANS].sort());
  });

  it("solo el administrador actúa sobre cualquier categoría; el administrador no toma ni resuelve", () => {
    const acciones = PERMISOS_POR_ROL[R.ADMINISTRADOR].acciones;
    expect(acciones.map((regla) => regla.accion)).not.toContain(A.TOMAR);
    expect(acciones.map((regla) => regla.accion)).not.toContain(A.RESOLVER);
    for (const [rol, permisos] of Object.entries(PERMISOS_POR_ROL)) {
      if (rol === R.ADMINISTRADOR) continue;
      for (const regla of permisos.acciones) expect(regla.categorias, `${rol} ${regla.accion}`).toBeDefined();
    }
  });

  it("ninguna regla actúa sobre un archivado salvo reabrir, y reabrir solo sobre un archivado", () => {
    for (const permisos of Object.values(PERMISOS_POR_ROL)) {
      for (const regla of permisos.acciones) {
        if (regla.accion === A.REABRIR) expect(regla.estados).toEqual([E.ARCHIVADO]);
        else expect(regla.estados).not.toContain(E.ARCHIVADO);
        if (regla.accion === A.ARCHIVAR) expect([...regla.estados].sort()).toEqual([E.CLASIFICADO, E.DERIVADO, E.EN_GESTION].sort());
      }
    }
  });

  it("ninguna regla deriva sin revisión ni revisa lo ya revisado", () => {
    for (const permisos of Object.values(PERMISOS_POR_ROL)) {
      for (const regla of permisos.acciones) {
        if (regla.accion === A.DERIVAR) expect(regla.revisada).toBe(true);
        if (regla.accion === A.CONFIRMAR || regla.accion === A.CORREGIR) expect(regla.revisada).toBe(false);
      }
    }
  });

  describe("categoriasParaCorregir", () => {
    const sinRevisar = (categoria: C) => caso(E.CLASIFICADO, categoria, false);

    it("el establecimiento y el gestor cambian entre queja, reclamo y otro, y pueden reclasificar a corrupción (sale a OTRANS)", () => {
      for (const rol of [R.ESTABLECIMIENTO, R.GESTOR]) {
        expect(categoriasParaCorregir([rol], sinRevisar(C.QUEJA)).sort()).toEqual(Object.values(C).sort());
      }
    });

    it("OTRANS y el administrador pueden cambiar a cualquier categoría", () => {
      expect(categoriasParaCorregir([R.OTRANS], sinRevisar(C.DENUNCIA_CORRUPCION)).sort()).toEqual(Object.values(C).sort());
      expect(categoriasParaCorregir([R.ADMINISTRADOR], sinRevisar(C.QUEJA)).sort()).toEqual(Object.values(C).sort());
    });

    it("une las de varios roles y es vacío si no puede corregir ese caso", () => {
      expect(categoriasParaCorregir([R.ESTABLECIMIENTO, R.ADMINISTRADOR], sinRevisar(C.QUEJA)).sort()).toEqual(Object.values(C).sort());
      expect(categoriasParaCorregir([R.ESTABLECIMIENTO], caso(E.CLASIFICADO, C.QUEJA, true))).toEqual([]);
      expect(categoriasParaCorregir([R.ESTABLECIMIENTO], sinRevisar(C.DENUNCIA_CORRUPCION))).toEqual([]);
      expect(categoriasParaCorregir([R.DIRIS, "INVENTADO", "constructor"], sinRevisar(C.QUEJA))).toEqual([]);
    });
  });

  describe("reglasDeAvisos (qué casos pendientes cuenta la campana de cada persona)", () => {
    const reglasDe = (rol: keyof typeof PERMISOS_POR_ROL) => PERMISOS_POR_ROL[rol].acciones;

    it("quien actúa cuenta lo que le toca atender: las reglas de sus roles", () => {
      expect(reglasDeAvisos([R.GESTOR])).toEqual(reglasDe(R.GESTOR));
      expect(reglasDeAvisos([R.ESTABLECIMIENTO])).toEqual(reglasDe(R.ESTABLECIMIENTO));
    });

    it("con varios roles que actúan se juntan sus reglas", () => {
      expect(reglasDeAvisos([R.GESTOR, R.OTRANS])).toEqual([...reglasDe(R.GESTOR), ...reglasDe(R.OTRANS)]);
    });

    it("el administrador cuenta todos los casos abiertos que ve, y eso gana si también tiene otro rol", () => {
      expect(reglasDeAvisos([R.ADMINISTRADOR])).toBeNull();
      expect(reglasDeAvisos([R.GESTOR, R.ADMINISTRADOR])).toBeNull();
    });

    it("sin roles o con roles que la tabla no conoce no cuenta nada", () => {
      expect(reglasDeAvisos([])).toEqual([]);
      expect(reglasDeAvisos([R.DIRIS, "INVENTADO", "constructor"])).toEqual([]);
    });
  });

  it("cada rol vigente declara si ve los casos sin categoría: solo el administrador", () => {
    const quienVe = Object.entries(PERMISOS_POR_ROL)
      .filter(([, permisos]) => permisos.veSinCategoria)
      .map(([rol]) => rol);
    expect(quienVe).toEqual([R.ADMINISTRADOR]);
  });

  describe("veTodasLasAreas", () => {
    it("el administrador y el gestor listan todas las áreas; OTRANS y el establecimiento, la suya", () => {
      expect(veTodasLasAreas([R.ADMINISTRADOR])).toBe(true);
      expect(veTodasLasAreas([R.GESTOR])).toBe(true);
      expect(veTodasLasAreas([R.OTRANS])).toBe(false);
      expect(veTodasLasAreas([R.ESTABLECIMIENTO])).toBe(false);
      expect(veTodasLasAreas([R.OTRANS, R.ADMINISTRADOR])).toBe(true);
    });

    it("sin roles o con roles que la tabla no conoce no ve todas", () => {
      expect(veTodasLasAreas([])).toBe(false);
      expect(veTodasLasAreas([R.DIRIS, "INVENTADO", "constructor"])).toBe(false);
    });
  });

  describe("invariante: la corrupción nunca queda en un establecimiento", () => {
    const CASOS_DE_CORRUPCION: Caso[] = [E.REGISTRADO, E.CLASIFICADO, E.DERIVADO, E.EN_GESTION, E.RESUELTO, E.ARCHIVADO].flatMap((estado) =>
      [true, false].map((revisada) => caso(estado, C.DENUNCIA_CORRUPCION, revisada)),
    );

    it("el establecimiento y el gestor no tienen ninguna acción sobre un caso de corrupción, en ningún estado", () => {
      for (const rol of [R.ESTABLECIMIENTO, R.GESTOR]) {
        for (const c of CASOS_DE_CORRUPCION) expect(accionesPermitidas([rol], c), `${rol} ${c.estado}`).toEqual([]);
      }
    });

    it("ninguna regla del establecimiento o del gestor cubre corrupción, salvo como destino al corregir", () => {
      for (const rol of [R.ESTABLECIMIENTO, R.GESTOR]) {
        for (const regla of PERMISOS_POR_ROL[rol].acciones) {
          expect(regla.categorias, `${rol} ${regla.accion}`).toBeDefined();
          expect(regla.categorias).not.toContain(C.DENUNCIA_CORRUPCION);
        }
      }
    });
  });
});
