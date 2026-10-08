import { describe, expect, it, vi } from "vitest";
import { CLAVE_INICIAL_ALFABETO, CLAVE_INICIAL_LONGITUD } from "@/constants/usuarios.js";
import { generarClaveInicial } from "@/utils/clave-inicial.js";

describe("generarClaveInicial", () => {
  it("tiene al menos 16 caracteres (20 por defecto)", () => {
    expect(CLAVE_INICIAL_LONGITUD).toBeGreaterThanOrEqual(16);
    expect(generarClaveInicial()).toHaveLength(CLAVE_INICIAL_LONGITUD);
  });

  it("solo usa caracteres sin ambigüedad: ni 0, O, 1, l, I", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generarClaveInicial()).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
    }
    for (const ambiguo of ["0", "O", "1", "l", "I"]) expect(CLAVE_INICIAL_ALFABETO).not.toContain(ambiguo);
  });

  it("no repite: mil claves distintas", () => {
    const claves = new Set(Array.from({ length: 1000 }, () => generarClaveInicial()));
    expect(claves.size).toBe(1000);
  });

  it("reparte los caracteres de todo el alfabeto, sin sesgo evidente", () => {
    const conteo = new Map<string, number>();
    for (let i = 0; i < 400; i += 1) {
      for (const caracter of generarClaveInicial()) conteo.set(caracter, (conteo.get(caracter) ?? 0) + 1);
    }
    expect(conteo.size).toBe(CLAVE_INICIAL_ALFABETO.length);
  });

  it("usa el generador criptográfico del sistema, no Math.random", async () => {
    const aleatorio = vi.spyOn(Math, "random");
    generarClaveInicial();
    expect(aleatorio).not.toHaveBeenCalled();
    aleatorio.mockRestore();
  });

  it("acepta otra longitud y otro alfabeto", () => {
    expect(generarClaveInicial(5, "ab")).toMatch(/^[ab]{5}$/);
  });
});
