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

  it.each([
    ["incidencia_paciente: el area de destino solo se reasigna mientras el caso esta CLASIFICADO o DERIVADO", "El área de destino solo se cambia mientras el caso está clasificado o derivado."],
    ["incidencia_paciente: el caso sensible esta en un area que no recibe casos sensibles y no hay una unica area que los reciba", "Una denuncia por corrupción no puede quedar en el área de un establecimiento."],
    ["incidencia_paciente: el establecimiento de origen no se puede modificar", "El establecimiento de origen del caso no se puede cambiar."],
    ["incidencia_paciente: archivar un caso exige un motivo de archivo", "Para archivar el caso hay que indicar el motivo."],
    ["incidencia_paciente: el motivo de archivo solo se indica al archivar el caso", "El motivo de archivo solo se indica al archivar el caso."],
    ["incidencia_paciente: un archivado manual solo se hace desde un caso abierto (REGISTRADO, CLASIFICADO, DERIVADO o EN_GESTION)", "Solo se archiva a mano un caso abierto: registrado, clasificado, derivado o en gestión."],
    ["incidencia_paciente: un archivado manual (datos insuficientes o no corresponde) lo hace una persona; el filtro del sistema solo archiva por datos insuficientes desde REGISTRADO o CLASIFICADO", "Solo una persona archiva un caso a mano."],
    ["incidencia_paciente: un caso abierto solo se archiva por vencimiento del plazo de atencion (lo hace el sistema) o por un motivo manual con justificacion", "Un caso abierto solo se archiva cuando vence su plazo de atención."],
    ["incidencia_paciente: el motivo de archivo no corresponde a un caso resuelto", "El motivo de archivo no corresponde al estado del caso."],
    ["incidencia_paciente: la justificacion del archivo solo se indica al archivar el caso", "La justificación solo se indica al archivar el caso."],
    ["incidencia_paciente: solo se reabre un caso archivado por datos insuficientes, porque no corresponde o por vencimiento sin atender", "Este caso no se puede reabrir: solo se reabren los archivados por datos insuficientes, por no corresponder o por vencimiento sin atender."],
    ["incidencia_paciente: el motivo de la reapertura solo se indica al reabrir el caso", "El motivo de la reapertura solo se indica al reabrir el caso."],
    ["incidencia_paciente: las fechas y actores de derivacion, toma, archivado y reapertura los llena la base", "Las fechas y los responsables de la derivación, la toma, el archivo y la reapertura los llena el sistema."],
  ])("traduce la regla de áreas o de archivo «%s» a un 409", (mensajeDeLaBase, esperado) => {
    expect(traducirErrorDeBase(errorDeBase(mensajeDeLaBase))).toMatchObject({ statusCode: 409, errorCode: ErrorCode.CONFLICT, message: esperado });
  });

  it.each([
    ["incidencia_paciente: DERIVADO y EN_GESTION exigen un area de destino", "El caso necesita un área de destino para derivarlo o tomarlo."],
    ["incidencia_paciente: el area de destino esta desactivada", "El área de destino está desactivada."],
    ["incidencia_paciente: un caso sensible solo se deriva a un area que reciba casos sensibles", "Una denuncia por corrupción solo se deriva a la oficina de transparencia (OTRANS), no a un establecimiento."],
    ["incidencia_paciente: el establecimiento de origen no existe o esta desactivado", "El establecimiento de origen no existe o está desactivado."],
    ["incidencia_paciente: la resolucion exige las medidas tomadas y el fundamento (10 caracteres o mas cada uno) y un resultado", "Para resolver el caso hay que indicar las medidas tomadas y el fundamento (10 caracteres o más cada uno) y el resultado."],
    ["incidencia_paciente: un archivado manual exige una justificacion de 10 caracteres o mas", "Para archivar el caso hay que explicar el motivo con 10 caracteres o más."],
    ["incidencia_paciente: reabrir un caso exige un motivo de 10 caracteres o mas", "Para reabrir el caso hay que explicar el motivo con 10 caracteres o más."],
    ["usuario_rol: el tipo de area del rol no coincide con el area del usuario", "El rol no corresponde al tipo de área del usuario."],
    ["usuario_interno: el tipo de area no coincide con el de los roles del usuario", "El área no corresponde a los roles del usuario."],
    ["usuario_rol: el rol esta desactivado y no se puede asignar", "El rol está desactivado y no se puede asignar."],
  ])("traduce el dato que quien lo envía puede corregir «%s» a un 422", (mensajeDeLaBase, esperado) => {
    expect(traducirErrorDeBase(errorDeBase(mensajeDeLaBase))).toMatchObject({ statusCode: 422, errorCode: ErrorCode.UNPROCESSABLE, message: esperado });
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
