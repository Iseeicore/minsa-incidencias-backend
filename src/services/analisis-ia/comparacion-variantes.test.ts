import { describe, expect, it } from "vitest";
import {
  acuerdoDeMarcas,
  combinarCriterios,
  decidirVeredicto,
  evaluarCriterios,
  IdCriterio,
  intervaloWilson,
  Lado,
  media,
  paresDiscordantes,
  percentil,
  Veredicto,
  type MarcaPareada,
  type MedidasParaCriterios,
} from "@/services/analisis-ia/comparacion-variantes.js";

/** Medidas que cumplen todos los criterios, con margen. */
const BUENAS: MedidasParaCriterios = {
  recallB: 0.98,
  recallParesA: 0.99,
  recallParesB: 0.98,
  fpB: 0.08,
  fpParesA: 0.08,
  fpParesB: 0.09,
  acuerdoMarca: 0.98,
  exactitudParesA: 0.9,
  exactitudParesB: 0.89,
  acuerdoQuejaReclamoB: 0.9,
  jsonPrimerIntentoB: 1,
  latenciaMediaB: 3_300,
  p90B: 4_000,
  latenciaMediaParesA: 15_000,
  latenciaMediaParesB: 3_300,
};

const veredictoDe = (cambios: Partial<MedidasParaCriterios>) =>
  decidirVeredicto(evaluarCriterios({ ...BUENAS, ...cambios }));
const criterioDe = (cambios: Partial<MedidasParaCriterios>, id: IdCriterio) =>
  evaluarCriterios({ ...BUENAS, ...cambios }).find((c) => c.id === id);

describe("intervalo de Wilson al 95 %", () => {
  it("coincide con valores conocidos", () => {
    const a = intervaloWilson(8, 10);
    expect(a?.inferior).toBeCloseTo(0.4902, 3);
    expect(a?.superior).toBeCloseTo(0.9433, 3);
    const b = intervaloWilson(60, 60);
    expect(b?.inferior).toBeCloseTo(0.9398, 3);
    expect(b?.superior).toBe(1);
    const c = intervaloWilson(0, 10);
    expect(c?.inferior).toBe(0);
    expect(c?.superior).toBeCloseTo(0.2775, 3);
  });

  it("sin casos no hay intervalo, y 50 de 100 es simétrico alrededor de 0,5", () => {
    expect(intervaloWilson(0, 0)).toBeNull();
    const m = intervaloWilson(50, 100);
    expect((m?.inferior ?? 0) + (m?.superior ?? 0)).toBeCloseTo(1, 6);
  });
});

describe("estadísticos simples", () => {
  it("media y percentil por rango más cercano", () => {
    expect(media([])).toBeNull();
    expect(media([2, 4])).toBe(3);
    const valores = [5, 1, 3, 2, 4, 10, 9, 8, 7, 6];
    expect(percentil(valores, 0.9)).toBe(9);
    expect(percentil(valores, 0.5)).toBe(5);
    expect(percentil(valores, 1)).toBe(10);
    expect(percentil([], 0.9)).toBeNull();
  });
});

describe("pares discordantes", () => {
  const pares: MarcaPareada[] = [
    {
      id: "a",
      tipoCaso: "x",
      marcaA: true,
      marcaB: true,
      esperadoCorrupcion: true,
    },
    {
      id: "b",
      tipoCaso: "y",
      marcaA: true,
      marcaB: false,
      esperadoCorrupcion: true,
    },
    {
      id: "c",
      tipoCaso: null,
      marcaA: false,
      marcaB: true,
      esperadoCorrupcion: false,
    },
    {
      id: "d",
      tipoCaso: "z",
      marcaA: false,
      marcaB: false,
      esperadoCorrupcion: false,
    },
  ];

  it("lista solo los que difieren, con su lado y quién acertó, sin textos", () => {
    expect(paresDiscordantes(pares)).toEqual([
      {
        id: "b",
        tipoCaso: "y",
        lado: Lado.SOLO_A,
        esperadoCorrupcion: true,
        acierta: "A",
      },
      {
        id: "c",
        tipoCaso: null,
        lado: Lado.SOLO_B,
        esperadoCorrupcion: false,
        acierta: "A",
      },
    ]);
  });

  it("el acuerdo es la proporción de marcas iguales; sin pares es null", () => {
    expect(acuerdoDeMarcas(pares)).toBe(0.5);
    expect(acuerdoDeMarcas([])).toBeNull();
    expect(paresDiscordantes([])).toEqual([]);
  });
});

describe("veredicto de la sección 21", () => {
  it("Viable cuando cumple Q1 a Q5, S1 y S2", () => {
    const criterios = evaluarCriterios(BUENAS);
    expect(criterios.every((c) => c.cumple)).toBe(true);
    expect(decidirVeredicto(criterios).veredicto).toBe(Veredicto.VIABLE);
  });

  it("los umbrales son inclusivos: recall 95 %, 3 puntos de caída, FP 15 %, acuerdo 95 %, JSON 99 %, 5 s, 8 s y 3 veces", () => {
    const enElBorde: Partial<MedidasParaCriterios> = {
      recallB: 57 / 60,
      recallParesA: 0.95,
      recallParesB: 0.92,
      fpB: 0.15,
      fpParesA: 0.1,
      fpParesB: 0.13,
      acuerdoMarca: 0.95,
      exactitudParesA: 0.9,
      exactitudParesB: 0.87,
      acuerdoQuejaReclamoB: 0.85,
      jsonPrimerIntentoB: 0.99,
      latenciaMediaB: 5_000,
      p90B: 8_000,
      latenciaMediaParesA: 15_000,
      latenciaMediaParesB: 5_000,
    };
    expect(veredictoDe(enElBorde).veredicto).toBe(Veredicto.VIABLE);
  });

  it("Q1: un recall de 94,9 % o una caída de más de 3 puntos frente a V2 es No viable", () => {
    expect(veredictoDe({ recallB: 0.949 }).veredicto).toBe(Veredicto.NO_VIABLE);
    const caida = veredictoDe({
      recallParesA: 1,
      recallParesB: 0.96,
      recallB: 0.96,
    });
    expect(caida.veredicto).toBe(Veredicto.NO_VIABLE);
    expect(caida.casoNoPrevistoPorLaSeccion).toBe(false);
    expect(
      criterioDe({ recallParesA: 1, recallParesB: 0.96 }, IdCriterio.Q1)
        ?.faltaPuntos,
    ).toBe(1);
  });

  it("Q5: un JSON válido al primer intento de 98 % es No viable aunque lo demás cumpla", () => {
    expect(veredictoDe({ jsonPrimerIntentoB: 0.98 }).veredicto).toBe(
      Veredicto.NO_VIABLE,
    );
  });

  it("falla un solo criterio de Q2 a Q4 por menos de 2 puntos: Viable con reservas", () => {
    const fp = veredictoDe({ fpB: 0.16 });
    expect(fp.veredicto).toBe(Veredicto.VIABLE_CON_RESERVAS);
    expect(fp.motivo).toContain("Q2");
    expect(veredictoDe({ acuerdoMarca: 0.94 }).veredicto).toBe(
      Veredicto.VIABLE_CON_RESERVAS,
    );
    expect(
      veredictoDe({ exactitudParesA: 0.9, exactitudParesB: 0.86 }).veredicto,
    ).toBe(Veredicto.VIABLE_CON_RESERVAS);
    expect(veredictoDe({ acuerdoQuejaReclamoB: 0.84 }).veredicto).toBe(
      Veredicto.VIABLE_CON_RESERVAS,
    );
  });

  it("falla por exactamente 2 puntos: ya no es «por poco» y la sección no lo prevé", () => {
    const v = veredictoDe({ fpB: 0.17 });
    expect(v.veredicto).toBe(Veredicto.NO_VIABLE);
    expect(v.casoNoPrevistoPorLaSeccion).toBe(true);
  });

  it("falla más de un criterio de Q2 a Q4, aunque sea por poco: No viable (previsto)", () => {
    const v = veredictoDe({ fpB: 0.16, acuerdoMarca: 0.94 });
    expect(v.veredicto).toBe(Veredicto.NO_VIABLE);
    expect(v.casoNoPrevistoPorLaSeccion).toBe(false);
  });

  it("Q1 que falla gana sobre cualquier reserva", () => {
    expect(veredictoDe({ recallB: 0.9, fpB: 0.16 }).veredicto).toBe(
      Veredicto.NO_VIABLE,
    );
  });

  it("S1 y S2: la latencia media, las 3 veces o el p90 que fallan dan No viable marcado como caso no previsto", () => {
    for (const cambio of [
      { latenciaMediaB: 5_001, latenciaMediaParesB: 5_001 },
      { latenciaMediaParesA: 9_000 },
      { p90B: 8_001 },
    ]) {
      const v = veredictoDe(cambio);
      expect(v.veredicto).toBe(Veredicto.NO_VIABLE);
      expect(v.casoNoPrevistoPorLaSeccion).toBe(true);
    }
  });

  it("un dato que falta cuenta como criterio incumplido, nunca como cumplido", () => {
    const sinRecall = criterioDe({ recallB: null }, IdCriterio.Q1);
    expect(sinRecall?.cumple).toBe(false);
    expect(sinRecall?.faltaPuntos).toBeNull();
    expect(veredictoDe({ recallB: null }).veredicto).toBe(Veredicto.NO_VIABLE);
    expect(veredictoDe({ latenciaMediaParesB: 0 }).veredicto).toBe(
      Veredicto.NO_VIABLE,
    );
  });
});

describe("combinar conjuntos", () => {
  it("un criterio cumple solo si cumple en todos los conjuntos y su falta es la mayor", () => {
    const desarrollo = evaluarCriterios(BUENAS);
    const prueba = evaluarCriterios({ ...BUENAS, recallB: 0.9, fpB: 0.16 });
    const combinado = combinarCriterios([desarrollo, prueba]);
    expect(combinado.find((c) => c.id === IdCriterio.Q1)).toMatchObject({
      cumple: false,
      faltaPuntos: 5,
    });
    expect(combinado.find((c) => c.id === IdCriterio.Q3)?.cumple).toBe(true);
    expect(decidirVeredicto(combinado).veredicto).toBe(Veredicto.NO_VIABLE);
    expect(
      decidirVeredicto(combinarCriterios([desarrollo, desarrollo])).veredicto,
    ).toBe(Veredicto.VIABLE);
  });
});
