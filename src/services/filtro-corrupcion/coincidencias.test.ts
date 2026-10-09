import { describe, expect, it } from "vitest";
import {
  buscarCoincidencias,
  compilarPlantilla,
  crearIndice,
  expandirPlantilla,
  resolverChoques,
} from "@/services/filtro-corrupcion/coincidencias.js";
import { normalizarTexto, marcarMontos, quitarMontos, tokenizar } from "@/services/filtro-corrupcion/normalizar-texto.js";

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

describe("marcarMontos", () => {
  it("deja la palabra monto donde había un importe en dinero y quita los demás números", () => {
    expect(marcarMontos(tokenizar("me pidio 300 soles para adelantar"))).toEqual(["me", "pidio", "monto", "para", "adelantar"]);
    expect(marcarMontos(tokenizar("me cobraron s/ 50 sin recibo"))).toEqual(["me", "cobraron", "monto", "sin", "recibo"]);
    expect(marcarMontos(tokenizar("espere 4 dias por 10 sol"))).toEqual(["espere", "dias", "por", "monto"]);
    expect(marcarMontos(tokenizar("el sol de la s tarde"))).toEqual(["el", "sol", "de", "la", "s", "tarde"]);
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

  it("conserva las clases de palabras (@clase) y rechaza una clase que no existe", () => {
    expect(compilarPlantilla("@verbo_cobro plata")).toEqual([["@verbo_cobro", "plata"]]);
    expect(() => compilarPlantilla("@no_existe plata")).toThrow(/Clase de palabras desconocida/);
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

  it("una clase calza con cualquiera de sus palabras, también al inicio de la frase", () => {
    const indice = crearIndice(entradas([["@verbo_cobro ~ plata", 2]]));
    expect(buscarCoincidencias(tokenizar("el jefe cobra plata"), indice)).toHaveLength(1);
    expect(buscarCoincidencias(tokenizar("el jefe pidio ya la plata"), indice)).toHaveLength(1);
    expect(buscarCoincidencias(tokenizar("el jefe saludo y la plata"), indice)).toHaveLength(0);
  });

  it("un monto en medio no corta una frase que no lo nombra, y sí calza si la frase dice monto", () => {
    const sinMonto = crearIndice(entradas([["cobraron sin recibo", 2]]));
    const conMonto = crearIndice(entradas([["cobraron monto", 2]]));
    const palabras = marcarMontos(tokenizar("me cobraron 50 soles sin recibo"));
    expect(buscarCoincidencias(palabras, sinMonto)).toHaveLength(1);
    expect(buscarCoincidencias(palabras, conMonto)).toHaveLength(1);
    expect(buscarCoincidencias(tokenizar("me cobraron sin recibo"), conMonto)).toHaveLength(0);
  });

  it("las frases de una misma familia que se pisan cuentan una sola vez: queda la de más puntos", () => {
    const indice = crearIndice(
      ["me cobraron ~ para darme la cita", "cobraron monto"].flatMap((plantilla, i) =>
        compilarPlantilla(plantilla).map((patron) => ({ patron, entrada: { peso: 3 - i, grupo: plantilla, familia: "cobro" } })),
      ),
    );
    const palabras = marcarMontos(tokenizar("me cobraron 50 soles para darme la cita"));
    expect(resolverChoques(buscarCoincidencias(palabras, indice)).map((c) => c.entrada.grupo)).toEqual([
      "me cobraron ~ para darme la cita",
    ]);
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
