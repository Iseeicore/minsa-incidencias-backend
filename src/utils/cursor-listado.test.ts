import { describe, expect, it } from "vitest";
import { codificarCursor, decodificarCursor } from "@/utils/cursor-listado.js";

const POSICION = { fechaCreacion: new Date("2026-10-05T12:34:56.789Z"), id: "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b" };
const base64url = (texto: string): string => Buffer.from(texto, "utf8").toString("base64url");

describe("cursor del listado", () => {
  it("va y vuelve sin perder los milisegundos ni el id", () => {
    expect(decodificarCursor(codificarCursor(POSICION))).toEqual(POSICION);
  });

  it("es opaco y seguro para una URL: solo letras, números, guion y guion bajo", () => {
    const cursor = codificarCursor(POSICION);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(POSICION.id);
  });

  it.each([
    ["vacío", ""],
    ["con caracteres que no son base64url", "abc+/="],
    ["sin separador", base64url("2026-10-05T12:34:56.789Z")],
    ["con tres partes", base64url(`2026-10-05T12:34:56.789Z|${POSICION.id}|x`)],
    ["con una fecha inventada", base64url(`ayer|${POSICION.id}`)],
    ["con una fecha que no está en formato ISO", base64url(`2026-10-05|${POSICION.id}`)],
    ["con un id que no es UUID", base64url("2026-10-05T12:34:56.789Z|1 OR 1=1")],
  ])("rechaza un cursor %s", (_nombre, cursor) => {
    expect(decodificarCursor(cursor)).toBeNull();
  });
});
