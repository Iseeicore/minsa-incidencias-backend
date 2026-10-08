import { describe, expect, it } from "vitest";
import { CertezaCorrupcion as C, TipoContacto, TipoEntidad } from "@/enums/filtro-corrupcion.enum.js";
import { CATALOGO_ENTIDADES } from "@/services/filtro-corrupcion/catalogo-entidades.data.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

const porCodigo = (codigo: string) => {
  const entidad = CATALOGO_ENTIDADES.find((e) => e.codigo === codigo);
  if (!entidad) throw new Error(`no hay ${codigo} en el catálogo`);
  return entidad;
};

describe("catálogo generado", () => {
  it("trae las 37 entidades de la nota (36 numeradas más el FISSAL, 2.1), sin códigos repetidos", () => {
    expect(CATALOGO_ENTIDADES).toHaveLength(37);
    expect(new Set(CATALOGO_ENTIDADES.map(({ codigo }) => codigo)).size).toBe(37);
  });

  it("cada entidad trae tipo, titular y los cuatro contactos (con null donde no figuran)", () => {
    for (const { codigo, tipo, titular, contactos } of CATALOGO_ENTIDADES) {
      expect(tipo, codigo).toBeDefined();
      expect(titular?.cargo, codigo).toBeTruthy();
      expect(Object.keys(contactos ?? {}).sort(), codigo).toEqual(Object.values(TipoContacto).sort());
    }
  });

  it("la nota marca huecos: el MINSA sin nombre de titular y el FISSAL sin ningún contacto", () => {
    expect(porCodigo("minsa").huecos).toContain("SIN_NOMBRE_TITULAR");
    expect(porCodigo("fissal").huecos).toContain("SIN_CONTACTOS");
    expect(porCodigo("hnal").huecos).toContain("DIRECTORIO_INCOMPLETO");
  });
});

describe("entidad: las 37 se detectan por su nombre y por cada alias (incluida la sigla)", () => {
  const formas = CATALOGO_ENTIDADES.flatMap((e) =>
    [e.nombre, ...(e.alias ?? [])].map((forma) => ({ codigo: e.codigo, tipo: e.tipo, forma })),
  );

  it.each(formas)("$codigo: «$forma»", ({ codigo, tipo, forma }) => {
    const resultado = evaluarTextoCorrupcion(`Denuncio que en ${forma} hoy mismo piden coima`);
    expect(resultado.entidad?.codigo).toBe(codigo);
    expect(resultado.entidad?.tipo).toBe(tipo);
    expect(resultado.senales.filter(({ tipo: t }) => t === "ENTIDAD")).toHaveLength(1);
  });

  it("detecta también la sigla principal escrita en mayúsculas, minúsculas o con signos", () => {
    for (const texto of [
      "EN EL SIS PIDEN COIMA",
      "en el sis piden coima",
      "¡¡en el (SIS) piden coima!!",
      "allá piden coima a todos (SIS)",
    ]) {
      expect(evaluarTextoCorrupcion(texto).entidad?.codigo, texto).toBe("sis");
    }
  });

  it("sin tildes, con mayúsculas y con errores comunes de escritura", () => {
    const casos: [string, string][] = [
      ["me pidieron coima en el HOSPITAL HIPOLITO UNANUE", "hnhu"],
      ["me pidieron coima en el hospital loaiza", "hnal"],
      ["me pidieron coima en el Hospital Dos De Mayo", "hndm"],
      ["me pidieron coima en el Sistema Integrado de Salud", "sis"],
      ["me pidieron coima en la DIRIS Lima Norte", "diris-ln"],
      ["me pidieron coima en el Hospital Víctor Larco Herrera", "hvlh"],
      ["me pidieron coima en el Ministerio de Salud del Perú", "minsa"],
      ["me pidieron coima en el Minsa", "minsa"],
    ];
    for (const [texto, codigo] of casos) expect(evaluarTextoCorrupcion(texto).entidad?.codigo, texto).toBe(codigo);
  });
});

describe("entidad: palabras que se parecen y ambigüedades", () => {
  it.each([
    "En plena crisis del sistema hospitalario me pidieron coima",
    "El sistema de citas de la clínica es una crisis y piden coima",
    "Hospitalario es el trato, pero piden coima en la caja",
  ])("no confunde palabras parecidas: %s", (texto) => {
    const resultado = evaluarTextoCorrupcion(texto);
    expect(resultado.entidad).toBeNull();
    expect(resultado.senales.some(({ tipo }) => tipo === "ENTIDAD")).toBe(false);
  });

  it("«ministerio» suelto no es el MINSA (puede ser cualquier ministerio): solo «ministerio de salud» o «minsa»", () => {
    for (const texto of [
      "pidieron coima en el Ministerio",
      "pidieron coima en el Ministerio de Educación",
      "pidieron coima en el Ministerio Público",
    ]) {
      expect(evaluarTextoCorrupcion(texto).entidad, texto).toBeNull();
    }
    expect(evaluarTextoCorrupcion("pidieron coima en el Ministerio de Salud").entidad?.codigo).toBe("minsa");
  });

  it("«DIRIS LE» no es alias (el «le» es un pronombre), pero «DIRIS Lima Este» sí; «DIRIS» a secas no elige ninguna", () => {
    expect(evaluarTextoCorrupcion("la diris le pidió coima a mi mamá").entidad).toBeNull();
    expect(evaluarTextoCorrupcion("la diris pidió coima a mi mamá").entidad).toBeNull();
    expect(evaluarTextoCorrupcion("la DIRIS Lima Este pidió coima a mi mamá").entidad?.codigo).toBe("diris-le");
  });

  it("un nombre que es el comienzo del de otras entidades no se elige si el texto no termina de decir cuál", () => {
    expect(evaluarTextoCorrupcion("pidieron coima en el Instituto Nacional de Salud del Niño").entidad).toBeNull();
    expect(evaluarTextoCorrupcion("pidieron coima en el Instituto Nacional de Salud Mental").entidad?.codigo).toBe("insm");
    expect(evaluarTextoCorrupcion("pidieron coima en el Instituto Nacional de Salud del Niño San Borja").entidad?.codigo).toBe("insnsb");
    expect(evaluarTextoCorrupcion("pidieron coima en el Instituto Nacional de Salud del Niño Breña").entidad?.codigo).toBe("insn");
    expect(evaluarTextoCorrupcion("pidieron coima en el Instituto Nacional de Salud de Lima").entidad?.codigo).toBe("ins");
  });

  it("con varias entidades en el texto se queda con la que aparece primero y suma una sola vez", () => {
    const resultado = evaluarTextoCorrupcion("En el Hospital Loayza, que depende del MINSA y del SIS, piden coima");
    expect(resultado.entidad?.codigo).toBe("hnal");
    expect(resultado.senales.filter(({ tipo }) => tipo === "ENTIDAD")).toHaveLength(1);
    expect(resultado.puntaje).toBe(4);
  });

  it("una entidad fuera del catálogo da entidad null (no se busca ni se inventa)", () => {
    const resultado = evaluarTextoCorrupcion("En el Hospital Regional de Chiclayo me pidieron coima");
    expect(resultado.entidad).toBeNull();
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.referenciaDerivacion).toBeNull();
    expect(resultado.requiereOtrans).toBe(true);
  });
});

describe("titular: cargo máximo y equivalentes", () => {
  it.each([
    ["el director general del hospital me pidió coima", "director general", false],
    ["la directora general me pidió coima", "directora general", false],
    ["el jefe institucional me pidió coima", "jefe institucional", false],
    ["el director ejecutivo me pidió coima", "director ejecutivo", true],
    ["la directora ejecutiva me pidió coima", "directora ejecutiva", true],
    ["el director del hospital me pidió coima", "director del hospital", true],
    ["la directora de la DIRIS me pidió coima", "directora de la diris", true],
    ["la jefa del SIS me pidió coima", "jefa del sis", true],
    ["el superintendente me pidió coima", "superintendente", true],
    ["el presidente ejecutivo me pidió coima", "presidente ejecutivo", true],
    ["el coordinador general me pidió coima", "coordinador general", true],
    ["el ministro de salud me pidió coima", "ministro de salud", true],
  ])("%s", (texto, cargo, esEquivalenteDelMaximo) => {
    expect(evaluarTextoCorrupcion(texto).titular).toEqual({ cargo, esEquivalenteDelMaximo, nombreCoincide: false });
  });

  it("un cargo de línea o el personal no son titular", () => {
    for (const texto of ["el director me pidió coima en admisión", "el jefe de logística me pidió coima", "la enfermera me pidió coima"]) {
      expect(evaluarTextoCorrupcion(texto).titular, texto).toBeNull();
    }
  });

  it("el cargo y la entidad suman una sola vez cada uno aunque el texto los repita", () => {
    const resultado = evaluarTextoCorrupcion(
      "El director general y el director ejecutivo del Hospital Loayza y del Hospital Dos de Mayo piden coima, coima y más coima",
    );
    expect(resultado.senales.filter(({ tipo }) => tipo === "ACTOR")).toHaveLength(1);
    expect(resultado.senales.filter(({ tipo }) => tipo === "ENTIDAD")).toHaveLength(1);
    expect(resultado.puntaje).toBe(5);
  });
});

describe("titular: el nombre solo informa", () => {
  const BASE = "El director general del Hospital Loayza me pidió coima en consulta";
  const CON_NOMBRE = "El director general del Hospital Loayza, Eduardo Franklin Yong Motta, me pidió coima en consulta";
  const OTRO_NOMBRE = "El director general del Hospital Loayza, Pedro Pérez Gómez, me pidió coima en consulta";

  it("detecta que el texto nombra al titular del catálogo (sin importar mayúsculas ni tildes)", () => {
    expect(evaluarTextoCorrupcion(CON_NOMBRE).titular?.nombreCoincide).toBe(true);
    expect(evaluarTextoCorrupcion(CON_NOMBRE.toUpperCase()).titular?.nombreCoincide).toBe(true);
    expect(evaluarTextoCorrupcion("el director general del hospital loayza, yong motta, me pidió coima").titular?.nombreCoincide).toBe(
      true,
    );
  });

  it("un nombre de pila suelto, un homónimo parcial u otro nombre no coinciden", () => {
    expect(evaluarTextoCorrupcion(BASE).titular?.nombreCoincide).toBe(false);
    expect(evaluarTextoCorrupcion(OTRO_NOMBRE).titular?.nombreCoincide).toBe(false);
    expect(evaluarTextoCorrupcion("el director general del hospital loayza, Eduardo, me pidió coima").titular?.nombreCoincide).toBe(false);
  });

  it("sin entidad detectada o sin nombre registrado (MINSA) no hay coincidencia posible", () => {
    expect(evaluarTextoCorrupcion("el director general Eduardo Franklin Yong Motta me pidió coima").titular?.nombreCoincide).toBe(false);
    expect(evaluarTextoCorrupcion("el ministro de salud del MINSA, Juan Carlos Pérez, me pidió coima").titular?.nombreCoincide).toBe(false);
  });

  it("que el nombre coincida, falte o sea otro NO cambia el puntaje, la certeza, la propuesta ni las señales", () => {
    const base = evaluarTextoCorrupcion(BASE);
    for (const texto of [CON_NOMBRE, OTRO_NOMBRE]) {
      const resultado = evaluarTextoCorrupcion(texto);
      expect(resultado.puntaje).toBe(base.puntaje);
      expect(resultado.certeza).toBe(base.certeza);
      expect(resultado.propuestaCorrupcion).toBe(base.propuestaCorrupcion);
      expect(resultado.senales).toEqual(base.senales);
      expect(resultado.requiereOtrans).toBe(base.requiereOtrans);
    }
  });

  it("nombrar al titular sin ninguna señal de corrupción tampoco propone corrupción", () => {
    const resultado = evaluarTextoCorrupcion("El director general del Hospital Loayza, Eduardo Franklin Yong Motta, no me atendió bien");
    expect(resultado.titular?.nombreCoincide).toBe(true);
    expect(resultado.propuestaCorrupcion).toBe(false);
    expect(resultado.certeza).toBe(C.BAJA);
  });
});

describe("la entidad y el cargo suman pero no deciden", () => {
  it("con entidad y cargo pero sin señal de corrupción nunca se propone corrupción", () => {
    const resultado = evaluarTextoCorrupcion("El director general del Hospital Loayza y el jefe del SIS no me atendieron bien en la cita");
    expect(resultado.entidad?.codigo).toBe("hnal");
    expect(resultado.titular).not.toBeNull();
    expect(resultado.puntaje).toBe(2);
    expect(resultado.propuestaCorrupcion).toBe(false);
    expect(resultado.certeza).toBe(C.BAJA);
    expect(resultado.requiereOtrans).toBe(false);
    expect(resultado.referenciaDerivacion).toBeNull();
    expect(resultado.faltantes).toEqual([]);
  });

  it("la señal débil sola no basta, pero con la entidad del catálogo llega a 2: es la suma prevista por el léxico (sección 2)", () => {
    expect(evaluarTextoCorrupcion("la atención del hospital es una corrupción total").propuestaCorrupcion).toBe(false);
    const resultado = evaluarTextoCorrupcion("la atención del Hospital Loayza es una corrupción total");
    expect(resultado.puntaje).toBe(2);
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.certeza).toBe(C.MEDIA);
  });
});

describe("destino sugerido", () => {
  it("corrupción propuesta: requiere OTRANS y referencia a la entidad con sus contactos disponibles", () => {
    const resultado = evaluarTextoCorrupcion("En el SIS me pidieron plata para atenderme y tengo fotos");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.requiereOtrans).toBe(true);
    expect(resultado.referenciaDerivacion).toEqual({ codigoEntidad: "sis", contactosDisponibles: ["OCI", "PROCURADOR"] });
  });

  it("la referencia lista solo los contactos que el directorio trae (FISSAL: ninguno)", () => {
    const resultado = evaluarTextoCorrupcion("En el FISSAL me pidieron plata para atenderme y tengo fotos");
    expect(resultado.referenciaDerivacion).toEqual({ codigoEntidad: "fissal", contactosDisponibles: [] });
  });

  it("sin entidad en el catálogo: requiere OTRANS pero no hay referencia", () => {
    const resultado = evaluarTextoCorrupcion("me pidieron plata para atenderme en la emergencia");
    expect(resultado.requiereOtrans).toBe(true);
    expect(resultado.referenciaDerivacion).toBeNull();
  });

  it("si no se propone corrupción no se pide OTRANS ni se refiere ninguna entidad", () => {
    const resultado = evaluarTextoCorrupcion("Pagué en caja del SIS y me dieron boleta por la consulta");
    expect(resultado.entidad?.codigo).toBe("sis");
    expect(resultado.requiereOtrans).toBe(false);
    expect(resultado.referenciaDerivacion).toBeNull();
  });

  it("un texto corto tampoco pide OTRANS", () => {
    expect(evaluarTextoCorrupcion("coima en el SIS")).toMatchObject({
      aplica: false,
      requiereOtrans: false,
      referenciaDerivacion: null,
      titular: null,
    });
  });
});

describe("tipos del catálogo", () => {
  it("clasifica por el nombre oficial", () => {
    expect(porCodigo("minsa").tipo).toBe(TipoEntidad.MINISTERIO);
    expect(porCodigo("sis").tipo).toBe(TipoEntidad.SIS);
    expect(porCodigo("insn").tipo).toBe(TipoEntidad.INSTITUTO);
    expect(porCodigo("hnal").tipo).toBe(TipoEntidad.HOSPITAL);
    expect(porCodigo("diris-ls").tipo).toBe(TipoEntidad.DIRIS);
    expect(porCodigo("susalud").tipo).toBe(TipoEntidad.ORGANISMO);
  });
});
