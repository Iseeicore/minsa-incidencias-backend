import { describe, expect, it } from "vitest";
import { traducirErrorDeBase } from "@/database/reglas-de-la-base.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { AppError } from "@/errors/app-error.js";

const errorDeBase = (message: string, code = "23514") => Object.assign(new Error(message), { code });

describe("traducirErrorDeBase", () => {
  it.each([
    ["incidencia_paciente: la categoria ya se corrigio una vez", "La categoría ya se corrigió una vez."],
    ["incidencia_paciente: la categoria ya se confirmo y no se puede corregir", "La categoría ya se confirmó y no se puede corregir."],
    ["incidencia_paciente: la confirmacion se registra una sola vez y no se quita", "La categoría ya se confirmó."],
    ["incidencia_paciente: una categoria corregida no se puede confirmar", "La categoría ya se corrigió y no se puede confirmar."],
    ["incidencia_paciente: la resolucion solo se registra una vez", "El caso ya tiene una resolución."],
    ["incidencia_paciente: transicion de estado no permitida (3 a 6)", "El caso no puede pasar a ese estado desde el que tiene ahora."],
    ["incidencia_paciente: no hay categoria de la IA que confirmar", "El caso todavía no tiene una categoría de la IA que confirmar."],
  ])("traduce «%s» a un 409 en español", (mensajeDeLaBase, esperado) => {
    const traducido = traducirErrorDeBase(errorDeBase(mensajeDeLaBase));
    expect(traducido).toBeInstanceOf(AppError);
    expect(traducido).toMatchObject({ statusCode: 409, errorCode: ErrorCode.CONFLICT, message: esperado });
  });

  it("una regla que no conocemos también es un 409, sin repetir el texto técnico de la base", () => {
    const traducido = traducirErrorDeBase(errorDeBase("ck_incidencia_paciente_estado: algo raro"));
    expect(traducido).toMatchObject({
      statusCode: 409,
      errorCode: ErrorCode.CONFLICT,
      message: "El cambio no cumple una regla del caso.",
    });
    expect((traducido as AppError).message).not.toContain("ck_incidencia");
  });

  it("un error que no es una regla de la base se devuelve igual", () => {
    const original = errorDeBase("connection terminated", "57P01");
    expect(traducirErrorDeBase(original)).toBe(original);
  });

  it("un AppError pasa sin cambios", () => {
    const original = new AppError(403, ErrorCode.FORBIDDEN);
    expect(traducirErrorDeBase(original)).toBe(original);
  });

  it("lo que no es un error se devuelve igual", () => {
    expect(traducirErrorDeBase("texto")).toBe("texto");
    expect(traducirErrorDeBase(null)).toBeNull();
  });
});
