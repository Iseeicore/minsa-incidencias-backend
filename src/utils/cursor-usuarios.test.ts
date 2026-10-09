import { describe, expect, it } from "vitest";
import { codificarCursorDeUsuarios, decodificarCursorDeUsuarios } from "@/utils/cursor-usuarios.js";

const base64url = (texto: string): string => Buffer.from(texto, "utf8").toString("base64url");
const ID = "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b";

describe("cursor del listado de usuarios", () => {
  it("va y vuelve con tildes y con el separador dentro del nombre", () => {
    for (const posicion of [
      { nombre: "Ana María Quispe", id: ID },
      { nombre: "Ñandú | Pérez", id: ID },
    ]) {
      expect(decodificarCursorDeUsuarios(codificarCursorDeUsuarios(posicion))).toEqual(posicion);
    }
  });

  it("es opaco y seguro para una URL", () => {
    const cursor = codificarCursorDeUsuarios({ nombre: "Ana Quispe", id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain("Ana");
  });

  it.each([
    ["vacío", ""],
    ["con caracteres que no son base64url", "abc+/="],
    ["sin separador", base64url(ID)],
    ["con id que no es uuid", base64url("12|Ana")],
    ["con id en mayúsculas", base64url(`${ID.toUpperCase()}|Ana`)],
    ["con id inyectado", base64url(`${ID}' OR '1'='1|Ana`)],
    ["con nombre vacío", base64url(`${ID}|`)],
    ["con nombre demasiado largo", base64url(`${ID}|${"a".repeat(301)}`)],
    ["con nombre con byte nulo", base64url(`${ID}|Ana\u0000`)],
  ])("rechaza un cursor %s", (_nombre, cursor) => {
    expect(decodificarCursorDeUsuarios(cursor)).toBeNull();
  });
});
