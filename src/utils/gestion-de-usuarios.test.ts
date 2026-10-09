import { describe, expect, it } from "vitest";
import { AlcanceDeUsuarios, PERMISOS_POR_ROL } from "@/constants/permisos-por-rol.js";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { gestionDeUsuarios } from "@/utils/gestion-de-usuarios.js";

describe("gestionDeUsuarios", () => {
  it("el administrador gestiona los de cualquier área y asigna cualquier rol vigente", () => {
    const gestion = gestionDeUsuarios([R.ADMINISTRADOR]);
    expect(gestion?.alcance).toBe(AlcanceDeUsuarios.TODAS);
    expect([...(gestion?.rolesAsignables ?? [])].sort()).toEqual([R.ADMINISTRADOR, R.ESTABLECIMIENTO, R.GESTOR, R.OTRANS].sort());
  });

  it("el responsable del establecimiento gestiona solo su área y asigna solo gestor o establecimiento", () => {
    const gestion = gestionDeUsuarios([R.ESTABLECIMIENTO]);
    expect(gestion?.alcance).toBe(AlcanceDeUsuarios.SU_AREA);
    expect([...(gestion?.rolesAsignables ?? [])].sort()).toEqual([R.ESTABLECIMIENTO, R.GESTOR].sort());
    expect(gestion?.rolesAsignables).not.toContain(R.ADMINISTRADOR);
    expect(gestion?.rolesAsignables).not.toContain(R.OTRANS);
  });

  it("el gestor y OTRANS no gestionan usuarios", () => {
    expect(gestionDeUsuarios([R.GESTOR])).toBeNull();
    expect(gestionDeUsuarios([R.OTRANS])).toBeNull();
    expect(gestionDeUsuarios([R.GESTOR, R.OTRANS])).toBeNull();
  });

  it("con varios roles gana el alcance más amplio y se juntan los roles asignables", () => {
    const gestion = gestionDeUsuarios([R.ESTABLECIMIENTO, R.ADMINISTRADOR]);
    expect(gestion?.alcance).toBe(AlcanceDeUsuarios.TODAS);
    expect(gestion?.rolesAsignables).toContain(R.OTRANS);
    expect(gestionDeUsuarios([R.GESTOR, R.ESTABLECIMIENTO])?.alcance).toBe(AlcanceDeUsuarios.SU_AREA);
  });

  it("sin roles o con roles que la tabla no conoce no gestiona nada", () => {
    expect(gestionDeUsuarios([])).toBeNull();
    expect(gestionDeUsuarios([R.DIRIS, "INVENTADO", "constructor", "__proto__"])).toBeNull();
  });

  it("ningún rol asignable es el desactivado DIRIS y todos existen en la tabla", () => {
    for (const permisos of Object.values(PERMISOS_POR_ROL)) {
      for (const asignable of permisos.usuarios?.rolesAsignables ?? []) {
        expect(Object.keys(PERMISOS_POR_ROL)).toContain(asignable);
      }
    }
  });
});
