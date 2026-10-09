import { describe, expect, it } from "vitest";
import { assertBaseDesechable } from "@/database/base-desechable.js";

describe("assertBaseDesechable", () => {
  it.each(["gestion_desechable", "chatbot_dev", "gestion_local"])("acepta la base %s", (nombre) => {
    expect(() => assertBaseDesechable(`postgresql://postgres@localhost:5432/${nombre}`)).not.toThrow();
  });

  it.each(["chatbot", "chatbot_prueba", "gestion_desechable_real", "produccion"])("rechaza la base %s", (nombre) => {
    expect(() => assertBaseDesechable(`postgresql://postgres@localhost:5432/${nombre}`)).toThrow(/desechable/);
  });

  it("acepta parámetros en la URL y rechaza una URL sin nombre de base", () => {
    expect(() => assertBaseDesechable("postgresql://u@h:5432/gestion_desechable?sslmode=disable")).not.toThrow();
    expect(() => assertBaseDesechable("postgresql://u@h:5432/")).toThrow(/desechable/);
  });

  it("no incluye la clave de la URL en el mensaje de error", () => {
    expect(() => assertBaseDesechable("postgresql://u:secreta@h:5432/produccion")).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secreta") }),
    );
  });
});
