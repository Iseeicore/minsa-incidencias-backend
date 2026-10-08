import { describe, expect, it } from "vitest";
import { PERMISOS_POR_ROL } from "@/constants/permisos-por-rol.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { vistasDeRoles } from "@/utils/vistas-de-roles.js";

const TODAS = [VistaCodigo.INICIO, VistaCodigo.CASOS, VistaCodigo.BANDEJAS, VistaCodigo.DERIVACIONES];
const SIN_DERIVACIONES = [VistaCodigo.INICIO, VistaCodigo.CASOS, VistaCodigo.BANDEJAS];
const VISTAS_POR_ROL = [
  [RolCodigo.ADMINISTRADOR, TODAS],
  [RolCodigo.GESTOR, TODAS],
  [RolCodigo.OTRANS, SIN_DERIVACIONES],
  [RolCodigo.ESTABLECIMIENTO, SIN_DERIVACIONES],
] as const;

describe("PERMISOS_POR_ROL", () => {
  it("declara exactamente los roles vigentes y deja fuera a DIRIS, que está desactivado", () => {
    expect(Object.keys(PERMISOS_POR_ROL).sort()).toEqual(VISTAS_POR_ROL.map(([rol]) => rol).sort());
    expect(Object.keys(PERMISOS_POR_ROL)).not.toContain(RolCodigo.DIRIS);
  });

  describe.each(VISTAS_POR_ROL)("el rol %s", (rol, esperadas) => {
    it("ve sus vistas, en el orden del menú", () => {
      expect(vistasDeRoles([rol])).toEqual(esperadas);
    });
  });

  it("solo el administrador y el gestor ven Derivaciones", () => {
    const conDerivaciones = Object.entries(PERMISOS_POR_ROL)
      .filter(([, permisos]) => permisos.vistas.includes(VistaCodigo.DERIVACIONES))
      .map(([rol]) => rol)
      .sort();
    expect(conDerivaciones).toEqual([RolCodigo.ADMINISTRADOR, RolCodigo.GESTOR].sort());
  });
});

describe("vistasDeRoles", () => {
  const permisos: Record<string, { vistas: VistaCodigo[] }> = {
    A: { vistas: [VistaCodigo.CASOS, VistaCodigo.INICIO] },
    B: { vistas: [VistaCodigo.DERIVACIONES, VistaCodigo.CASOS] },
    C: { vistas: [] },
  };

  it("sin roles no da ninguna vista", () => {
    expect(vistasDeRoles([])).toEqual([]);
  });

  it("une las vistas de varios roles sin repetir y en el orden del menú", () => {
    expect(vistasDeRoles(["B", "A"], permisos)).toEqual([VistaCodigo.INICIO, VistaCodigo.CASOS, VistaCodigo.DERIVACIONES]);
  });

  it("repetir un rol no cambia el resultado", () => {
    expect(vistasDeRoles(["A", "A"], permisos)).toEqual([VistaCodigo.INICIO, VistaCodigo.CASOS]);
  });

  it("un rol sin vistas no aporta nada", () => {
    expect(vistasDeRoles(["C"], permisos)).toEqual([]);
    expect(vistasDeRoles(["C", "B"], permisos)).toEqual([VistaCodigo.CASOS, VistaCodigo.DERIVACIONES]);
  });

  it("ignora los roles que la tabla no conoce, incluido DIRIS, que está desactivado", () => {
    expect(vistasDeRoles([RolCodigo.DIRIS])).toEqual([]);
    expect(vistasDeRoles(["ROL_INVENTADO", RolCodigo.GESTOR])).toEqual(TODAS);
  });

  it("no confunde un rol con propiedades heredadas del objeto", () => {
    expect(vistasDeRoles(["constructor", "__proto__", "toString"])).toEqual([]);
  });

  it("devuelve siempre un arreglo nuevo que se puede modificar sin tocar la tabla", () => {
    const vistas = vistasDeRoles([RolCodigo.GESTOR]);
    vistas.pop();
    expect(vistasDeRoles([RolCodigo.GESTOR])).toEqual(TODAS);
  });
});
