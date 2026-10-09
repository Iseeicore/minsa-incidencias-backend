import { describe, expect, it } from "vitest";
import {
  decidirVeredictoSeccion25,
  evaluarCriteriosSeccion25,
  gananciaNeta,
  IdCriterio25,
  UMBRALES_SECCION_25,
  VeredictoRag,
  type MedidasSeccion25,
} from "@/services/analisis-ia/comparacion-casos.js";
import { combinarCriterios } from "@/services/analisis-ia/comparacion-variantes.js";

/** Medidas que cumplen todo con margen (conjunto de prueba: ganancia neta mínima de 3). */
const BUENAS: MedidasSeccion25 = {
  umbralGananciaNeta: UMBRALES_SECCION_25.M1_GANANCIA_NETA_PRUEBA,
  recallR: 1,
  falsosNegativosR: 0,
  falsosNegativosBase: 0,
  fpR: 0.085,
  fpParesR: 0.085,
  fpParesBase: 0.085,
  jsonPrimerIntentoR: 1,
  latenciaMediaR: 3_400,
  latenciaMediaBase: 3_100,
  p90R: 4_000,
  gananciaNetaCategoria: 5,
  acuerdoQuejaReclamoR: 0.9,
  acuerdoQuejaReclamoBase: 0.88,
  exactitudR: 0.93,
  exactitudBase: 0.92,
  casosDelBancoEnElConjunto: 0,
  paresCasiDuplicadoEnElPrompt: 0,
  textosEnElInforme: 0,
};

const criterios = (cambios: Partial<MedidasSeccion25>) =>
  evaluarCriteriosSeccion25({ ...BUENAS, ...cambios });
const veredicto = (cambios: Partial<MedidasSeccion25>) =>
  decidirVeredictoSeccion25(criterios(cambios));
const criterio = (cambios: Partial<MedidasSeccion25>, id: IdCriterio25) =>
  criterios(cambios).find((c) => c.id === id);

describe("gananciaNeta", () => {
  it("cuenta los aciertos nuevos menos los perdidos", () => {
    expect(
      gananciaNeta([
        { aciertaR: true, aciertaBase: false },
        { aciertaR: true, aciertaBase: false },
        { aciertaR: false, aciertaBase: true },
        { aciertaR: true, aciertaBase: true },
        { aciertaR: false, aciertaBase: false },
      ]),
    ).toBe(1);
    expect(gananciaNeta([])).toBe(0);
  });
});

describe("criterios y veredicto de la sección 25", () => {
  it("Mejora comprobada cuando cumple todo", () => {
    expect(criterios({}).every((c) => c.cumple)).toBe(true);
    expect(veredicto({}).veredicto).toBe(VeredictoRag.MEJORA_COMPROBADA);
  });

  it("los umbrales son inclusivos: recall 95 %, 1 FN más, FP 15 % y 2 puntos, JSON 99 %, 5 s y 2 s, p90 8 s, ganancia neta 3, queja/reclamo 85 %", () => {
    const enElBorde: Partial<MedidasSeccion25> = {
      recallR: 0.95,
      falsosNegativosR: 4,
      falsosNegativosBase: 3,
      fpR: 0.15,
      fpParesR: 0.12,
      fpParesBase: 0.1,
      jsonPrimerIntentoR: 0.99,
      latenciaMediaR: 5_000,
      latenciaMediaBase: 3_000,
      p90R: 8_000,
      gananciaNetaCategoria: 3,
      acuerdoQuejaReclamoR: 0.85,
      acuerdoQuejaReclamoBase: 0.85,
      exactitudR: 0.9,
      exactitudBase: 0.9,
    };
    expect(veredicto(enElBorde).veredicto).toBe(VeredictoRag.MEJORA_COMPROBADA);
  });

  it("R1: recall menor de 95 % o 2 falsos negativos más que V2C es No viable", () => {
    expect(veredicto({ recallR: 0.949 }).veredicto).toBe(
      VeredictoRag.NO_VIABLE,
    );
    expect(
      veredicto({ falsosNegativosR: 2, falsosNegativosBase: 0 }).veredicto,
    ).toBe(VeredictoRag.NO_VIABLE);
    expect(criterio({ recallR: 0.9 }, IdCriterio25.R1)?.faltaPuntos).toBe(5);
  });

  it("R2, R3, V1 y V2 que fallan son No viable aunque haya mejora", () => {
    for (const cambio of [
      { fpR: 0.16 },
      { fpParesR: 0.11, fpParesBase: 0.085 },
      { jsonPrimerIntentoR: 0.98 },
      { latenciaMediaR: 5_001 },
      { latenciaMediaR: 4_500, latenciaMediaBase: 2_400 },
      { p90R: 8_001 },
    ]) {
      const v = veredicto({ ...cambio, gananciaNetaCategoria: 20 });
      expect(v.veredicto).toBe(VeredictoRag.NO_VIABLE);
    }
  });

  it("sin mejora suficiente (M1, M2 o M3) pero sin perder nada: Sin mejora clara", () => {
    const sinGanancia = veredicto({ gananciaNetaCategoria: 2 });
    expect(sinGanancia.veredicto).toBe(VeredictoRag.SIN_MEJORA_CLARA);
    expect(sinGanancia.motivo).toContain("M1");
    expect(veredicto({ acuerdoQuejaReclamoR: 0.84 }).veredicto).toBe(
      VeredictoRag.SIN_MEJORA_CLARA,
    );
    expect(
      veredicto({ acuerdoQuejaReclamoR: 0.9, acuerdoQuejaReclamoBase: 0.95 })
        .veredicto,
    ).toBe(VeredictoRag.SIN_MEJORA_CLARA);
    expect(veredicto({ exactitudR: 0.9, exactitudBase: 0.92 }).veredicto).toBe(
      VeredictoRag.SIN_MEJORA_CLARA,
    );
  });

  it("la higiene rota invalida una mejora: No viable", () => {
    for (const cambio of [
      { casosDelBancoEnElConjunto: 1 },
      { paresCasiDuplicadoEnElPrompt: 1 },
      { textosEnElInforme: 1 },
    ]) {
      const v = veredicto({ ...cambio, gananciaNetaCategoria: 30 });
      expect(v.veredicto).toBe(VeredictoRag.NO_VIABLE);
    }
  });

  it("un dato que falta cuenta como incumplido, nunca como cumplido", () => {
    const sinRecall = criterio({ recallR: null }, IdCriterio25.R1);
    expect(sinRecall?.cumple).toBe(false);
    expect(sinRecall?.faltaPuntos).toBeNull();
    expect(veredicto({ gananciaNetaCategoria: null }).veredicto).toBe(
      VeredictoRag.SIN_MEJORA_CLARA,
    );
  });

  it("la ganancia neta exigida depende del conjunto", () => {
    const enDesarrollo = {
      gananciaNetaCategoria: 4,
      umbralGananciaNeta: UMBRALES_SECCION_25.M1_GANANCIA_NETA_DESARROLLO,
    };
    expect(veredicto(enDesarrollo).veredicto).toBe(
      VeredictoRag.SIN_MEJORA_CLARA,
    );
    expect(veredicto({ gananciaNetaCategoria: 4 }).veredicto).toBe(
      VeredictoRag.MEJORA_COMPROBADA,
    );
  });
});

describe("combinar desarrollo y prueba", () => {
  it("un criterio cumple solo si cumple en los dos conjuntos", () => {
    const desarrollo = evaluarCriteriosSeccion25({
      ...BUENAS,
      umbralGananciaNeta: UMBRALES_SECCION_25.M1_GANANCIA_NETA_DESARROLLO,
      gananciaNetaCategoria: 7,
    });
    const prueba = evaluarCriteriosSeccion25({
      ...BUENAS,
      gananciaNetaCategoria: 1,
    });
    const combinado = combinarCriterios(
      [desarrollo, prueba],
      Object.values(IdCriterio25),
    );
    expect(combinado.find((c) => c.id === IdCriterio25.M1)?.cumple).toBe(false);
    expect(combinado.find((c) => c.id === IdCriterio25.R1)?.cumple).toBe(true);
    expect(decidirVeredictoSeccion25(combinado).veredicto).toBe(
      VeredictoRag.SIN_MEJORA_CLARA,
    );
  });
});
