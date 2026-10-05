import { describe, expect, it } from "vitest";
import { EstadoIncidencia as E } from "@/enums/estado-incidencia.enum.js";
import { PlazoEstado, PlazoTipo } from "@/enums/plazo.enum.js";
import { calcularPlazo, horasEntre } from "@/utils/plazo-incidencia.js";

const AHORA = new Date("2026-10-05T12:00:00.000Z");
const PLAZOS = { atencionDias: 3, vigenciaDias: 3, avisoHoras: 24 };
const haceHoras = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000);

describe("horasEntre", () => {
  it("cuenta horas completas hacia abajo", () => {
    expect(horasEntre(haceHoras(5.9), AHORA)).toBe(5);
    expect(horasEntre(haceHoras(0.5), AHORA)).toBe(0);
    expect(horasEntre(AHORA, haceHoras(-8))).toBe(8);
  });
});

describe("calcularPlazo de atención (3 días desde que llega)", () => {
  const plazo = (estado: E, horas: number, plazos = PLAZOS) =>
    calcularPlazo({ estado, fechaCreacion: haceHoras(horas), resueltoEn: null, ahora: AHORA }, plazos);

  it("recién llegado: en plazo con 62 horas restantes", () => {
    expect(plazo(E.CLASIFICADO, 10)).toEqual({
      tipo: PlazoTipo.ATENCION,
      estado: PlazoEstado.EN_PLAZO,
      venceEn: new Date(haceHoras(10).getTime() + 72 * 3_600_000).toISOString(),
      horasRestantes: 62,
    });
  });

  it("25 horas restantes sigue en plazo", () => {
    expect(plazo(E.CLASIFICADO, 47)).toMatchObject({ estado: PlazoEstado.EN_PLAZO, horasRestantes: 25 });
  });

  it("24 horas restantes ya es por vencer (el límite del aviso cuenta)", () => {
    expect(plazo(E.CLASIFICADO, 48)).toMatchObject({ estado: PlazoEstado.POR_VENCER, horasRestantes: 24 });
  });

  it("1 hora restante es por vencer", () => {
    expect(plazo(E.DERIVADO, 71)).toMatchObject({ estado: PlazoEstado.POR_VENCER, horasRestantes: 1 });
  });

  it("justo en el límite está vencido", () => {
    expect(plazo(E.EN_GESTION, 72)).toMatchObject({ estado: PlazoEstado.VENCIDO, horasRestantes: 0 });
  });

  it("pasado el límite sigue siendo atención y queda con horas negativas", () => {
    expect(plazo(E.REGISTRADO, 80)).toMatchObject({ tipo: PlazoTipo.ATENCION, estado: PlazoEstado.VENCIDO, horasRestantes: -8 });
  });

  it("respeta los días y el aviso configurados", () => {
    const corto = { atencionDias: 1, vigenciaDias: 3, avisoHoras: 2 };
    expect(plazo(E.CLASIFICADO, 21, corto)).toMatchObject({ estado: PlazoEstado.EN_PLAZO, horasRestantes: 3 });
    expect(plazo(E.CLASIFICADO, 22, corto)).toMatchObject({ estado: PlazoEstado.POR_VENCER, horasRestantes: 2 });
  });
});

describe("calcularPlazo de vigencia de la resolución (3 días desde que se resuelve)", () => {
  const plazo = (horas: number) =>
    calcularPlazo(
      { estado: E.RESUELTO, fechaCreacion: haceHoras(200), resueltoEn: haceHoras(horas), ahora: AHORA },
      PLAZOS,
    );

  it("resuelto hace 10 horas: vigente con 62 horas para archivarse", () => {
    expect(plazo(10)).toEqual({
      tipo: PlazoTipo.VIGENCIA,
      estado: PlazoEstado.EN_PLAZO,
      venceEn: new Date(haceHoras(10).getTime() + 72 * 3_600_000).toISOString(),
      horasRestantes: 62,
    });
  });

  it("la vigencia nunca marca por vencer: solo en plazo o vencido", () => {
    expect(plazo(60)).toMatchObject({ estado: PlazoEstado.EN_PLAZO, horasRestantes: 12 });
  });

  it("pasada la vigencia queda vencido, a la espera del archivado", () => {
    expect(plazo(80)).toMatchObject({ estado: PlazoEstado.VENCIDO, horasRestantes: -8 });
  });
});

describe("calcularPlazo sin plazo", () => {
  it("un caso archivado no tiene plazo", () => {
    expect(
      calcularPlazo({ estado: E.ARCHIVADO, fechaCreacion: haceHoras(300), resueltoEn: null, ahora: AHORA }, PLAZOS),
    ).toEqual({ tipo: null, estado: null, venceEn: null, horasRestantes: null });
  });

  it("un caso resuelto sin fecha de resolución no inventa un plazo", () => {
    expect(
      calcularPlazo({ estado: E.RESUELTO, fechaCreacion: haceHoras(30), resueltoEn: null, ahora: AHORA }, PLAZOS),
    ).toEqual({ tipo: null, estado: null, venceEn: null, horasRestantes: null });
  });
});
