import { describe, expect, it } from "vitest";
import { PERMISOS_POR_ROL } from "@/constants/permisos-por-rol.js";
import { AccionIncidencia as A } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia as C } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia as E } from "@/enums/estado-incidencia.enum.js";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { accionesPermitidas, reglasDeAvisos } from "@/utils/acciones-permitidas.js";

type Caso = Parameters<typeof accionesPermitidas>[1];
const caso = (estado: E, categoria: C | null, revisada: boolean): Caso => ({ estado, categoria, revisada });

type Fila = [string, readonly string[], E, C | null, boolean, A[]];

const MATRIZ: Fila[] = [
  ["administrador no actúa", [R.ADMINISTRADOR], E.CLASIFICADO, C.QUEJA, false, []],
  ["administrador no actúa en corrupción", [R.ADMINISTRADOR], E.DERIVADO, C.DENUNCIA_CORRUPCION, true, []],

  ["gestor confirma o corrige una queja sin revisar", [R.GESTOR], E.CLASIFICADO, C.QUEJA, false, [A.CONFIRMAR, A.CORREGIR]],
  ["gestor confirma o corrige un reclamo sin revisar", [R.GESTOR], E.CLASIFICADO, C.RECLAMO, false, [A.CONFIRMAR, A.CORREGIR]],
  ["gestor confirma o corrige un caso otro sin revisar", [R.GESTOR], E.CLASIFICADO, C.OTRO, false, [A.CONFIRMAR, A.CORREGIR]],
  ["gestor deriva una queja ya revisada", [R.GESTOR], E.CLASIFICADO, C.QUEJA, true, [A.DERIVAR]],
  ["gestor deriva un reclamo ya revisado", [R.GESTOR], E.CLASIFICADO, C.RECLAMO, true, [A.DERIVAR]],
  ["gestor no deriva un caso otro (solo quejas y reclamos)", [R.GESTOR], E.CLASIFICADO, C.OTRO, true, []],
  ["gestor no actúa sobre corrupción", [R.GESTOR], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, false, []],
  ["gestor no actúa sobre un caso sin categoría", [R.GESTOR], E.REGISTRADO, null, false, []],
  ["gestor no actúa en DERIVADO", [R.GESTOR], E.DERIVADO, C.QUEJA, true, []],
  ["gestor no actúa en EN_GESTION", [R.GESTOR], E.EN_GESTION, C.QUEJA, true, []],
  ["gestor no actúa en RESUELTO", [R.GESTOR], E.RESUELTO, C.QUEJA, true, []],
  ["gestor no actúa en ARCHIVADO", [R.GESTOR], E.ARCHIVADO, C.QUEJA, true, []],

  ["OTRANS confirma o corrige sin revisar", [R.OTRANS], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, false, [A.CONFIRMAR, A.CORREGIR]],
  ["OTRANS toma directo lo revisado, sin derivar", [R.OTRANS], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, true, [A.TOMAR]],
  ["OTRANS toma o resuelve lo derivado", [R.OTRANS], E.DERIVADO, C.DENUNCIA_CORRUPCION, true, [A.TOMAR, A.RESOLVER]],
  ["OTRANS resuelve lo que está en gestión", [R.OTRANS], E.EN_GESTION, C.DENUNCIA_CORRUPCION, true, [A.RESOLVER]],
  ["OTRANS no actúa en RESUELTO", [R.OTRANS], E.RESUELTO, C.DENUNCIA_CORRUPCION, true, []],
  ["OTRANS no actúa sobre una queja", [R.OTRANS], E.CLASIFICADO, C.QUEJA, false, []],
  ["OTRANS no deriva", [R.OTRANS], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, true, [A.TOMAR]],

  ["establecimiento no revisa una queja", [R.ESTABLECIMIENTO], E.CLASIFICADO, C.QUEJA, false, []],
  ["establecimiento no toma lo clasificado", [R.ESTABLECIMIENTO], E.CLASIFICADO, C.QUEJA, true, []],
  ["establecimiento toma o resuelve una queja derivada", [R.ESTABLECIMIENTO], E.DERIVADO, C.QUEJA, true, [A.TOMAR, A.RESOLVER]],
  ["establecimiento toma o resuelve un reclamo derivado", [R.ESTABLECIMIENTO], E.DERIVADO, C.RECLAMO, true, [A.TOMAR, A.RESOLVER]],
  ["establecimiento resuelve una queja en gestión", [R.ESTABLECIMIENTO], E.EN_GESTION, C.QUEJA, true, [A.RESOLVER]],
  ["establecimiento resuelve un reclamo en gestión", [R.ESTABLECIMIENTO], E.EN_GESTION, C.RECLAMO, true, [A.RESOLVER]],
  ["establecimiento no actúa sobre corrupción", [R.ESTABLECIMIENTO], E.DERIVADO, C.DENUNCIA_CORRUPCION, true, []],
  ["establecimiento no actúa sobre un caso otro", [R.ESTABLECIMIENTO], E.DERIVADO, C.OTRO, true, []],
  ["establecimiento no actúa en RESUELTO", [R.ESTABLECIMIENTO], E.RESUELTO, C.QUEJA, true, []],
  ["establecimiento no actúa en ARCHIVADO", [R.ESTABLECIMIENTO], E.ARCHIVADO, C.RECLAMO, true, []],

  ["gestor y establecimiento: confirma una queja sin revisar", [R.GESTOR, R.ESTABLECIMIENTO], E.CLASIFICADO, C.QUEJA, false, [A.CONFIRMAR, A.CORREGIR]],
  ["gestor y establecimiento: deriva una queja revisada", [R.GESTOR, R.ESTABLECIMIENTO], E.CLASIFICADO, C.QUEJA, true, [A.DERIVAR]],
  ["gestor y establecimiento: atiende una queja derivada", [R.GESTOR, R.ESTABLECIMIENTO], E.DERIVADO, C.QUEJA, true, [A.TOMAR, A.RESOLVER]],
  ["gestor y OTRANS: toma lo revisado de corrupción", [R.GESTOR, R.OTRANS], E.CLASIFICADO, C.DENUNCIA_CORRUPCION, true, [A.TOMAR]],

  ["DIRIS (desactivado) no da acciones", [R.DIRIS], E.DERIVADO, C.QUEJA, true, []],
  ["un rol inventado no da acciones", ["INVENTADO"], E.CLASIFICADO, C.QUEJA, false, []],
  ["un nombre heredado del objeto no da acciones", ["constructor"], E.CLASIFICADO, C.QUEJA, false, []],
  ["sin roles no hay acciones", [], E.CLASIFICADO, C.QUEJA, false, []],
];

describe("accionesPermitidas", () => {
  it.each(MATRIZ)("%s", (_nombre, roles, estado, categoria, revisada, esperadas) => {
    expect(accionesPermitidas(roles, caso(estado, categoria, revisada))).toEqual(esperadas);
  });

  it("devuelve las acciones en el orden confirmar, corregir, derivar, tomar y resolver, sin repetir", () => {
    const acciones = accionesPermitidas([R.OTRANS, R.OTRANS], caso(E.DERIVADO, C.DENUNCIA_CORRUPCION, true));
    expect(acciones).toEqual([A.TOMAR, A.RESOLVER]);
  });

  it("ninguna regla permite actuar sobre un caso archivado, y ninguna deriva sin revisión", () => {
    for (const permisos of Object.values(PERMISOS_POR_ROL)) {
      for (const regla of permisos.acciones) {
        expect(regla.estados).not.toContain(E.ARCHIVADO);
        if (regla.accion === A.DERIVAR) expect(regla.revisada).toBe(true);
        if (regla.accion === A.CONFIRMAR || regla.accion === A.CORREGIR) expect(regla.revisada).toBe(false);
      }
    }
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

    it("quien no actúa (el administrador) cuenta todos los casos abiertos que ve, y eso gana si también es gestor", () => {
      expect(reglasDeAvisos([R.ADMINISTRADOR])).toBeNull();
      expect(reglasDeAvisos([R.GESTOR, R.ADMINISTRADOR])).toBeNull();
    });

    it("sin roles o con roles que la tabla no conoce no cuenta nada", () => {
      expect(reglasDeAvisos([])).toEqual([]);
      expect(reglasDeAvisos([R.DIRIS, "INVENTADO", "constructor"])).toEqual([]);
    });
  });

  it("cada rol vigente declara si ve los casos sin categoría: solo el administrador y el gestor", () => {
    const quienVe = Object.entries(PERMISOS_POR_ROL)
      .filter(([, permisos]) => permisos.veSinCategoria)
      .map(([rol]) => rol)
      .sort();
    expect(quienVe).toEqual([R.ADMINISTRADOR, R.GESTOR].sort());
  });
});
