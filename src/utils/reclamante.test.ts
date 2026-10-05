import { describe, expect, it } from "vitest";
import { describirReclamante } from "@/utils/reclamante.js";

describe("describirReclamante", () => {
  it("un reporte anónimo no muestra nada de la persona", () => {
    expect(describirReclamante({ esAnonimo: true, nombre: null, dni: null })).toBe("Anónimo");
  });

  it("abrevia el nombre y enmascara el DNI dejando solo los últimos 4 dígitos", () => {
    const texto = describirReclamante({ esAnonimo: false, nombre: "Luis Alberto Quispe Huamán", dni: "00001907" });
    expect(texto).toBe("Luis A. · DNI ••••1907");
    expect(texto).not.toContain("00001907");
  });

  it("deja igual un nombre ya abreviado", () => {
    expect(describirReclamante({ esAnonimo: false, nombre: "Luis A.", dni: "00001907" })).toBe("Luis A. · DNI ••••1907");
  });

  it("un nombre de una sola palabra se queda como está", () => {
    expect(describirReclamante({ esAnonimo: false, nombre: "María", dni: "12345678" })).toBe("María · DNI ••••5678");
  });

  it("sin DNI muestra solo el nombre abreviado", () => {
    expect(describirReclamante({ esAnonimo: false, nombre: "Rosa Torres", dni: null })).toBe("Rosa T.");
  });

  it("sin nombre muestra solo el DNI enmascarado", () => {
    expect(describirReclamante({ esAnonimo: false, nombre: null, dni: "12345678" })).toBe("DNI ••••5678");
  });

  it("un DNI corto se enmascara por completo", () => {
    expect(describirReclamante({ esAnonimo: false, nombre: "Rosa Torres", dni: "123" })).toBe("Rosa T. · DNI ••••");
  });

  it("sin nombre ni DNI avisa que no hay datos", () => {
    expect(describirReclamante({ esAnonimo: false, nombre: null, dni: null })).toBe("Sin datos");
  });

  it("ignora los espacios sobrantes", () => {
    expect(describirReclamante({ esAnonimo: false, nombre: "  Ana   Paz  ", dni: " 00008841 " })).toBe("Ana P. · DNI ••••8841");
  });
});
