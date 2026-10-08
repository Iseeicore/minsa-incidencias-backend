import { describe, expect, it } from "vitest";
import {
  buscarCoincidencias,
  compilarPlantilla,
  crearIndice,
  expandirPlantilla,
  resolverChoques,
} from "@/services/filtro-corrupcion/coincidencias.js";
import { normalizarTexto, quitarMontos, tokenizar } from "@/services/filtro-corrupcion/normalizar-texto.js";

describe("normalizarTexto", () => {
  it("minúsculas, sin tildes, sin signos y con espacios simples", () => {
    expect(normalizarTexto("  ¡Pagué   20 soles, EN CAJA!  ")).toBe("pague 20 soles en caja");
    expect(normalizarTexto("CORRUPCIÓN y Ñandú")).toBe("corrupcion y nandu");
  });

  it("tokenizar devuelve palabras y un texto vacío no da palabras", () => {
    expect(tokenizar("¿Qué...?")).toEqual(["que"]);
    expect(tokenizar("  ¡! ")).toEqual([]);
  });

  it("quitarMontos saca números, soles y la s de s/", () => {
    expect(quitarMontos(tokenizar("pague s/ 20 en caja"))).toEqual(["pague", "en", "caja"]);
    expect(quitarMontos(tokenizar("pague 20 soles en caja"))).toEqual(["pague", "en", "caja"]);
    expect(quitarMontos(tokenizar("el sol de la s tarde"))).toEqual(["el", "sol", "de", "la", "s", "tarde"]);
  });
});

describe("plantillas", () => {
  it("expande variantes y variantes opcionales", () => {
    expect(expandirPlantilla("me {pidio|pidieron} {plata|dinero}")).toEqual([
      "me pidio plata",
      "me pidio dinero",
      "me pidieron plata",
      "me pidieron dinero",
    ]);
    expect(expandirPlantilla("copago {del sis|}")).toEqual(["copago del sis", "copago "]);
  });

  it("compila en palabras normalizadas y conserva el hueco", () => {
    expect(compilarPlantilla("Me cobraron ~ para Darme")).toEqual([["me", "cobraron", "~", "para", "darme"]]);
  });
});

describe("buscarCoincidencias y resolverChoques", () => {
  const entradas = (plantillas: [string, number][]) =>
    plantillas.flatMap(([plantilla, peso]) =>
      compilarPlantilla(plantilla).map((patron) => ({ patron, entrada: { peso, grupo: plantilla } })),
    );

  it("busca secuencias de palabras, no letras sueltas", () => {
    const indice = crearIndice(entradas([["coima", 3]]));
    expect(buscarCoincidencias(tokenizar("anticoima y coima"), indice)).toHaveLength(1);
  });

  it("un choque parcial deja la de más puntos; una frase con palabras propias dentro de otra no choca", () => {
    const indice = crearIndice(
      entradas([
        ["me cobraron ~ para darme la cita", 3],
        ["cobraron sin recibo", 2],
        ["recibo para darme", 1],
      ]),
    );
    const palabras = tokenizar("me cobraron sin recibo para darme la cita");
    const aceptadas = resolverChoques(buscarCoincidencias(palabras, indice)).map((c) => c.entrada.grupo);
    expect(aceptadas).toEqual(["me cobraron ~ para darme la cita", "cobraron sin recibo"]);
  });
});
