import { describe, expect, it } from "vitest";
import { codificarCursorDeAreas, decodificarCursorDeAreas } from "@/utils/cursor-areas.js";

const base64url = (texto: string): string => Buffer.from(texto, "utf8").toString("base64url");

describe("cursor del listado de áreas", () => {
  it("va y vuelve con tildes y con el separador dentro del nombre", () => {
    for (const posicion of [
      { nombre: "Hospital Nacional Dos de Mayo", id: 7 },
      { nombre: "Centro de Salud Ñaña | Anexo", id: 2_147_483_647 },
    ]) {
      expect(decodificarCursorDeAreas(codificarCursorDeAreas(posicion))).toEqual(posicion);
    }
  });

  it("es opaco y seguro para una URL", () => {
    const cursor = codificarCursorDeAreas({ nombre: "Hospital", id: 42 });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain("Hospital");
  });

  it.each([
    ["vacío", ""],
    ["con caracteres que no son base64url", "abc+/="],
    ["sin separador", base64url("12")],
    ["con id que no es número", base64url("uno|Hospital")],
    ["con id cero", base64url("0|Hospital")],
    ["con id con ceros a la izquierda", base64url("007|Hospital")],
    ["con id fuera de rango", base64url("2147483648|Hospital")],
    ["con id inyectado", base64url("1 OR 1=1|Hospital")],
    ["con nombre vacío", base64url("5|")],
    ["con nombre demasiado largo", base64url(`5|${"a".repeat(301)}`)],
  ])("rechaza un cursor %s", (_nombre, cursor) => {
    expect(decodificarCursorDeAreas(cursor)).toBeNull();
  });
});
