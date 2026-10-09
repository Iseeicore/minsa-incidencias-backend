import { describe, expect, it } from "vitest";
import { BANDAS_DE_CONFIANZA, PESO_MAXIMO_IA, TOPE_CONFIANZA, UMBRAL_TOTAL_CORRUPCION } from "@/constants/filtro-corrupcion.js";
import { AcuerdoReglasIa } from "@/enums/filtro-corrupcion.enum.js";
import { combinarReglasConIa, normalizarPesoIa } from "@/services/filtro-corrupcion/combinar-reglas-con-ia.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

const PROPUESTA_ALTA = evaluarTextoCorrupcion("El director del Hospital Dos de Mayo me pidio plata para darme la cama");
const PROPUESTA_MEDIA = evaluarTextoCorrupcion("hay trato preferencial para algunos pacientes del hospital");
const NEUTRO = evaluarTextoCorrupcion("La atencion del hospital fue lenta y me gritaron en la puerta");
const PUNTAJE_UNO = evaluarTextoCorrupcion("el doctor del hospital me atendio tarde en la consulta de hoy");
const ZONA_GRIS = evaluarTextoCorrupcion("El director del Hospital Dos de Mayo pide cosas a los pacientes que llegan");

describe("los textos de apoyo", () => {
  it("son los casos que cada prueba necesita", () => {
    expect(PROPUESTA_ALTA.propuestaCorrupcion).toBe(true);
    expect(PROPUESTA_ALTA.puntaje).toBeGreaterThanOrEqual(4);
    expect(PROPUESTA_MEDIA).toMatchObject({ propuestaCorrupcion: true, puntaje: 2 });
    expect(NEUTRO.puntaje).toBeLessThanOrEqual(0);
    expect(PUNTAJE_UNO).toMatchObject({ propuestaCorrupcion: false, puntaje: 1 });
    expect(ZONA_GRIS).toMatchObject({ propuestaCorrupcion: false, requiereSegundaOpinion: true });
  });
});

describe("normalizarPesoIa: el peso es un entero de 0 a PESO_MAXIMO_IA", () => {
  it("el máximo es 10", () => {
    expect(PESO_MAXIMO_IA).toBe(10);
  });

  it.each([
    [0, 0],
    [1, 1],
    [5, 5],
    [10, 10],
    [11, 10],
    [250, 10],
    [-3, 0],
    [3.4, 3],
    [3.6, 4],
    [9.7, 10],
    [Infinity, 10],
    [-Infinity, 0],
  ])("%s se usa como %s", (entrada, esperado) => {
    expect(normalizarPesoIa(entrada)).toBe(esperado);
  });

  it("null, undefined y NaN son 'sin modelo'", () => {
    expect(normalizarPesoIa(null)).toBeNull();
    expect(normalizarPesoIa(undefined)).toBeNull();
    expect(normalizarPesoIa(Number.NaN)).toBeNull();
  });
});

describe("combinarReglasConIa: el peso se suma y el total decide", () => {
  it("el peso del modelo se suma al puntaje de las reglas", () => {
    const resultado = combinarReglasConIa(PUNTAJE_UNO, 4);
    expect(resultado).toMatchObject({ puntajeReglas: 1, pesoIa: 4, puntajeTotal: 5 });
  });

  it("el tope del peso es 10: un 14 cuenta como 10", () => {
    const resultado = combinarReglasConIa(NEUTRO, 14);
    expect(resultado.pesoIa).toBe(10);
    expect(resultado.puntajeTotal).toBe(NEUTRO.puntaje + 10);
  });

  it("el modelo puede SUBIR un caso: el total debe superar el umbral (no basta igualarlo)", () => {
    expect(UMBRAL_TOTAL_CORRUPCION).toBe(5);
    const justo = combinarReglasConIa(PUNTAJE_UNO, 4); // 1 + 4 = 5: no supera
    expect(justo).toMatchObject({ propuestaCorrupcion: false, subidaPorIa: false, requiereOtrans: false });
    const sube = combinarReglasConIa(PUNTAJE_UNO, 5); // 1 + 5 = 6: supera
    expect(sube).toMatchObject({ propuestaCorrupcion: true, subidaPorIa: true, requiereOtrans: true, revisionOtrans: true });
  });

  it("un caso sin ninguna señal también puede subir si el modelo da el máximo", () => {
    const resultado = combinarReglasConIa(NEUTRO, 10);
    expect(NEUTRO.propuestaCorrupcion).toBe(false);
    expect(resultado.propuestaCorrupcion).toBe(NEUTRO.puntaje + 10 > UMBRAL_TOTAL_CORRUPCION);
  });

  it("el modelo NUNCA baja un caso que las reglas ya propusieron: ni con peso 0", () => {
    for (const reglas of [PROPUESTA_ALTA, PROPUESTA_MEDIA]) {
      for (const peso of [0, 1, 2, 5, 10]) {
        const resultado = combinarReglasConIa(reglas, peso);
        expect(resultado.propuestaCorrupcion, `peso ${peso}`).toBe(true);
        expect(resultado.requiereOtrans, `peso ${peso}`).toBe(true);
        expect(resultado.subidaPorIa).toBe(false);
      }
    }
  });

  it("peso bajo y reglas sin propuesta: sigue sin proponerse", () => {
    expect(combinarReglasConIa(NEUTRO, 0).propuestaCorrupcion).toBe(false);
    expect(combinarReglasConIa(PUNTAJE_UNO, 2).propuestaCorrupcion).toBe(false);
  });

  it("no modifica el resultado de las reglas", () => {
    const antes = structuredClone(PROPUESTA_ALTA);
    combinarReglasConIa(PROPUESTA_ALTA, 3);
    expect(PROPUESTA_ALTA).toEqual(antes);
  });
});

describe("combinarReglasConIa: sin modelo (null) y ante la duda, OTRANS", () => {
  it("zona gris y modelo no disponible: revisión de OTRANS por defecto, sin proponer corrupción", () => {
    const resultado = combinarReglasConIa(ZONA_GRIS, null);
    expect(resultado).toMatchObject({
      propuestaCorrupcion: false,
      requiereOtrans: false,
      revisionOtrans: true,
      requiereRevisionHumana: true,
      pesoIa: null,
      puntajeTotal: ZONA_GRIS.puntaje,
      acuerdo: AcuerdoReglasIa.SIN_MODELO,
    });
  });

  it("zona gris y el modelo sí respondió: el modelo resuelve la duda y no hay revisión por defecto", () => {
    expect(combinarReglasConIa(ZONA_GRIS, 0).revisionOtrans).toBe(false);
    const sube = combinarReglasConIa(ZONA_GRIS, 6);
    expect(sube).toMatchObject({ propuestaCorrupcion: true, subidaPorIa: true, revisionOtrans: true });
  });

  it("sin duda y sin modelo: solo valen las reglas", () => {
    expect(combinarReglasConIa(NEUTRO, null)).toMatchObject({
      propuestaCorrupcion: false,
      revisionOtrans: false,
      requiereRevisionHumana: false,
    });
    expect(combinarReglasConIa(PROPUESTA_ALTA, null)).toMatchObject({ propuestaCorrupcion: true, revisionOtrans: true });
  });

  it("undefined y NaN se tratan como sin modelo", () => {
    expect(combinarReglasConIa(ZONA_GRIS, undefined).revisionOtrans).toBe(true);
    expect(combinarReglasConIa(ZONA_GRIS, Number.NaN).pesoIa).toBeNull();
  });
});

describe("combinarReglasConIa: confianza derivada del acuerdo, nunca 100", () => {
  const dentroDe = (confianza: number, banda: { minimo: number; maximo: number }) => {
    expect(confianza).toBeGreaterThanOrEqual(banda.minimo);
    expect(confianza).toBeLessThanOrEqual(banda.maximo);
  };

  it("el tope es 95", () => {
    expect(TOPE_CONFIANZA).toBe(95);
  });

  it("coinciden con señales fuertes: 80 a 95", () => {
    const resultado = combinarReglasConIa(PROPUESTA_ALTA, 10);
    expect(resultado.acuerdo).toBe(AcuerdoReglasIa.COINCIDEN);
    dentroDe(resultado.confianza, BANDAS_DE_CONFIANZA.COINCIDEN_FUERTE);
  });

  it("coinciden con señales débiles: 65 a 80", () => {
    const resultado = combinarReglasConIa(PROPUESTA_MEDIA, 5);
    expect(resultado.acuerdo).toBe(AcuerdoReglasIa.COINCIDEN);
    dentroDe(resultado.confianza, BANDAS_DE_CONFIANZA.COINCIDEN_DEBIL);
  });

  it("coinciden en que no es corrupción: banda de coincidencia", () => {
    const resultado = combinarReglasConIa(NEUTRO, 0);
    expect(resultado.acuerdo).toBe(AcuerdoReglasIa.COINCIDEN);
    dentroDe(resultado.confianza, BANDAS_DE_CONFIANZA.COINCIDEN_FUERTE);
  });

  it("solo uno ve corrupción: 45 a 65", () => {
    for (const resultado of [combinarReglasConIa(PROPUESTA_ALTA, 3), combinarReglasConIa(PUNTAJE_UNO, 8)]) {
      expect(resultado.acuerdo).toBe(AcuerdoReglasIa.SOLO_UNO);
      dentroDe(resultado.confianza, BANDAS_DE_CONFIANZA.SOLO_UNO);
    }
  });

  it("discrepan: 30 a 50 y revisión humana marcada", () => {
    for (const resultado of [combinarReglasConIa(PROPUESTA_ALTA, 0), combinarReglasConIa(NEUTRO, 6)]) {
      expect(resultado.acuerdo).toBe(AcuerdoReglasIa.DISCREPAN);
      dentroDe(resultado.confianza, BANDAS_DE_CONFIANZA.DISCREPAN);
      expect(resultado.requiereRevisionHumana).toBe(true);
    }
  });

  it("sin modelo: banda de 'solo uno'", () => {
    for (const reglas of [PROPUESTA_ALTA, PROPUESTA_MEDIA, NEUTRO, ZONA_GRIS]) {
      const resultado = combinarReglasConIa(reglas, null);
      expect(resultado.acuerdo).toBe(AcuerdoReglasIa.SIN_MODELO);
      dentroDe(resultado.confianza, BANDAS_DE_CONFIANZA.SOLO_UNO);
    }
  });

  it("nunca llega a 100: ni con el mejor caso ni con ninguna combinación", () => {
    const mejor = evaluarTextoCorrupcion(
      "El director general del Hospital Dos de Mayo recibe coimas, me pidio plata para firmar y vende las medicinas del SIS, tengo fotos",
    );
    expect(combinarReglasConIa(mejor, 10).confianza).toBeLessThan(100);
    for (const reglas of [mejor, PROPUESTA_ALTA, PROPUESTA_MEDIA, PUNTAJE_UNO, NEUTRO, ZONA_GRIS]) {
      for (const peso of [null, ...Array.from({ length: 12 }, (_, i) => i)]) {
        const { confianza } = combinarReglasConIa(reglas, peso);
        expect(confianza).toBeLessThanOrEqual(TOPE_CONFIANZA);
        expect(confianza).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it("es un porcentaje con dos decimales como máximo", () => {
    for (const peso of [null, 0, 3, 5, 7, 10]) {
      const { confianza } = combinarReglasConIa(PROPUESTA_MEDIA, peso);
      expect(Math.round(confianza * 100) / 100).toBe(confianza);
    }
  });

  it("más acuerdo, más confianza: el peso máximo da más que el mínimo cuando coinciden", () => {
    expect(combinarReglasConIa(PROPUESTA_ALTA, 10).confianza).toBeGreaterThan(combinarReglasConIa(PROPUESTA_ALTA, 5).confianza);
  });
});
