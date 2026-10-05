import { describe, expect, it } from "vitest";
import { PERMISOS_POR_ROL } from "@/constants/permisos-por-rol.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { vistasDeRoles } from "@/utils/vistas-de-roles.js";

const TODAS = [VistaCodigo.INICIO, VistaCodigo.CASOS, VistaCodigo.BANDEJAS, VistaCodigo.DERIVACIONES];
const ROLES_VIGENTES = [
  RolCodigo.ADMINISTRADOR,
  RolCodigo.GESTOR,
  RolCodigo.AREA_DENUNCIA_CORRUPCION,
  RolCodigo.AREA_QUEJA,
  RolCodigo.AREA_RECLAMO,
];

describe("PERMISOS_POR_ROL", () => {
  it("declara exactamente los roles vigentes y deja fuera al revisor retirado", () => {
    expect(Object.keys(PERMISOS_POR_ROL).sort()).toEqual([...ROLES_VIGENTES].sort());
    expect(Object.keys(PERMISOS_POR_ROL)).not.toContain(RolCodigo.REVISOR);
  });

  describe.each(ROLES_VIGENTES)("el rol %s", (rol) => {
    it.each(TODAS)("ve la vista %s", (vista) => {
      expect(vistasDeRoles([rol])).toContain(vista);
    });

    it("ve las cuatro vistas, en el orden del menú", () => {
      expect(vistasDeRoles([rol])).toEqual(TODAS);
    });
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

  it("ignora los roles que la tabla no conoce, incluido el revisor retirado", () => {
    expect(vistasDeRoles([RolCodigo.REVISOR])).toEqual([]);
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
