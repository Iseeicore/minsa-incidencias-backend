import { describe, expect, it } from "vitest";
import { codigoRenipressBuscado } from "@/repositories/area.repository.js";

describe("codigoRenipressBuscado", () => {
  it.each([
    ["6206", "6206"],
    [" 6206 ", "6206"],
    ["000123", "123"],
    ["0", "0"],
  ])("un texto solo de dígitos (%j) busca el código %j", (texto, esperado) => {
    expect(codigoRenipressBuscado(texto)).toBe(esperado);
  });

  it.each(["hospital", "Cod6206", "62 06", "6206a", "%", "", "1e3"])("el texto %j no es un código", (texto) => {
    expect(codigoRenipressBuscado(texto)).toBeNull();
  });
});
