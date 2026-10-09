import { describe, expect, it } from "vitest";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { SenalSensible } from "@/enums/filtro-corrupcion.enum.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

describe("zona gris: entidad + titular o jefatura + verbo de cobro", () => {
  it("marca segunda opinión y, por la identidad, la propone con certeza baja para OTRANS (v1.3)", () => {
    const resultado = evaluarTextoCorrupcion("El director del Hospital Dos de Mayo pide cosas a los pacientes que llegan");
    expect(resultado.requiereSegundaOpinion).toBe(true);
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.origenPropuesta).toBe("IDENTIDAD");
    expect(resultado.certeza).toBe("BAJA");
    expect(resultado.requiereOtrans).toBe(true);
  });

  it("un pago legítimo (negativa decisiva) gana: sigue la duda pero no se propone corrupción", () => {
    const resultado = evaluarTextoCorrupcion("El director del Hospital Dos de Mayo pide cosas a los pacientes que pagaron en caja");
    expect(resultado.requiereSegundaOpinion).toBe(true);
    expect(resultado.propuestaCorrupcion).toBe(false);
    expect(resultado.requiereOtrans).toBe(false);
  });

  it("funciona con el titular del catálogo, con el jefe de una entidad y con variantes sin tildes ni mayúsculas", () => {
    expect(evaluarTextoCorrupcion("la jefa del SIS cobra a los afiliados cuando van al modulo").requiereSegundaOpinion).toBe(true);
    expect(evaluarTextoCorrupcion("EL DIRECTOR GENERAL DEL INEN EXIGE COSAS A LOS PACIENTES").requiereSegundaOpinion).toBe(true);
    expect(evaluarTextoCorrupcion("El jefe del FISSAL solicito algo a los proveedores hace poco").requiereSegundaOpinion).toBe(true);
  });

  it("si las reglas ya confirman corrupción no hace falta segunda opinión", () => {
    const resultado = evaluarTextoCorrupcion("El jefe del FISSAL le pide plata a los proveedores para firmar los pagos");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.requiereSegundaOpinion).toBe(false);
  });

  it("sin entidad del catálogo, sin jefatura o sin verbo de cobro no es zona gris", () => {
    expect(evaluarTextoCorrupcion("El director de la escuela pide cosas a los padres de familia").requiereSegundaOpinion).toBe(false);
    expect(evaluarTextoCorrupcion("Una enfermera del Hospital Dos de Mayo pide que esperemos afuera").requiereSegundaOpinion).toBe(false);
    expect(evaluarTextoCorrupcion("El director del Hospital Dos de Mayo atendio tarde a mi mama ayer").requiereSegundaOpinion).toBe(false);
  });

  it("un verbo de cobro negado no cuenta", () => {
    const resultado = evaluarTextoCorrupcion("El director del Hospital Dos de Mayo nunca pidio nada a los pacientes que llegan");
    expect(resultado.requiereSegundaOpinion).toBe(false);
  });

  it("un texto corto o sin catálogo tampoco", () => {
    expect(evaluarTextoCorrupcion("director pide").requiereSegundaOpinion).toBe(false);
    expect(
      evaluarTextoCorrupcion("El director del Hospital Dos de Mayo pide cosas a los pacientes que llegan", { entidades: [] })
        .requiereSegundaOpinion,
    ).toBe(false);
  });
});

describe("acoso, hostigamiento y tocamientos", () => {
  it("sin cargo mayor: señal sensible ACOSO, sugiere Reclamo y no escala", () => {
    const resultado = evaluarTextoCorrupcion("Una enfermera me toco la pierna sin mi permiso en la sala de espera");
    expect(resultado.senalSensible).toBe(SenalSensible.ACOSO);
    expect(resultado.categoriaSugerida).toBe(CategoriaIncidencia.RECLAMO);
    expect(resultado.escalarAOtrans).toBe(false);
  });

  it("con un cargo mayor (director, jefe, administrador, titular) escala a OTRANS", () => {
    for (const texto of [
      "El director me acoso y me hizo propuestas indecentes en su oficina",
      "El jefe de emergencia me hostiga con mensajes insinuantes todas las noches",
      "El administrador del hospital me manoseo cuando fui a pedir mi historia",
      "El ministro de salud tiene tocamientos indebidos con las practicantes segun cuentan",
    ]) {
      const resultado = evaluarTextoCorrupcion(texto);
      expect(resultado.senalSensible, texto).toBe(SenalSensible.ACOSO);
      expect(resultado.categoriaSugerida, texto).toBe(CategoriaIncidencia.RECLAMO);
      expect(resultado.escalarAOtrans, texto).toBe(true);
    }
  });

  it("cuenta con variantes sin tildes, en mayúsculas y con jerga", () => {
    expect(evaluarTextoCorrupcion("EL DOCTOR ME TOCO LA CINTURA Y ME ACOSA CADA VEZ QUE VOY").senalSensible).toBe("ACOSO");
    expect(evaluarTextoCorrupcion("el tecnico me toqueteo en el pasillo del hospital ayer").senalSensible).toBe("ACOSO");
    expect(evaluarTextoCorrupcion("me miraba con morbo y me hacia comentarios sexuales en consulta").senalSensible).toBe("ACOSO");
  });

  it("no suma al puntaje de corrupción ni propone corrupción", () => {
    const resultado = evaluarTextoCorrupcion("El director me acoso y me toco la pierna en su oficina del hospital");
    expect(resultado.puntaje).toBe(1);
    expect(resultado.senales.every(({ tipo }) => tipo === "ACTOR" || tipo === "ENTIDAD")).toBe(true);
    expect(resultado.propuestaCorrupcion).toBe(false);
  });

  it("acoso y corrupción pueden ir juntos: la corrupción sigue su camino", () => {
    const resultado = evaluarTextoCorrupcion("El director me acoso y ademas me pidio plata para darme la cama");
    expect(resultado.senalSensible).toBe(SenalSensible.ACOSO);
    expect(resultado.propuestaCorrupcion).toBe(true);
  });

  it("'me tocó esperar' o 'me tocó el hombro' no son acoso, y un acoso negado tampoco", () => {
    expect(evaluarTextoCorrupcion("Me toco esperar cuatro horas en el hospital para una cita").senalSensible).toBeNull();
    expect(evaluarTextoCorrupcion("La enfermera me toco el hombro para despertarme en la sala").senalSensible).toBeNull();
    expect(evaluarTextoCorrupcion("Nunca me acoso nadie, pero la atencion fue pesima en el hospital").senalSensible).toBeNull();
  });

  it("sin señal sensible los campos nuevos quedan neutros", () => {
    const resultado = evaluarTextoCorrupcion("No hay medicinas en la farmacia del hospital desde el lunes");
    expect(resultado).toMatchObject({ senalSensible: null, categoriaSugerida: null, escalarAOtrans: false, requiereSegundaOpinion: false });
  });
});
