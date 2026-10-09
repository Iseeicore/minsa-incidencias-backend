import { describe, expect, it } from "vitest";
import { CODIGO_DESTINO_ST_PAD_MINSA, PUNTOS_NOMBRE_TITULAR } from "@/constants/filtro-corrupcion.js";
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
    [e.nombre, ...(e.alias ?? []), ...(e.aliasDerivados ?? [])].map((forma) => ({ codigo: e.codigo, tipo: e.tipo, forma })),
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

  it("sin entidad nombrada el nombre del titular la identifica (v1.3); sin nombre registrado (MINSA) no hay coincidencia posible", () => {
    const sinEntidad = evaluarTextoCorrupcion("el director general Eduardo Franklin Yong Motta me pidió coima");
    expect(sinEntidad.titular?.nombreCoincide).toBe(true);
    expect(sinEntidad.entidad?.codigo).toBe("hnal");
    expect(evaluarTextoCorrupcion("el ministro de salud del MINSA, Juan Carlos Pérez, me pidió coima").titular?.nombreCoincide).toBe(false);
  });

  it("que el nombre coincida suma PUNTOS_NOMBRE_TITULAR; que falte o sea otro no cambia nada: puntaje, certeza, propuesta y señales", () => {
    const base = evaluarTextoCorrupcion(BASE);
    const otro = evaluarTextoCorrupcion(OTRO_NOMBRE);
    expect(otro.puntaje).toBe(base.puntaje);
    expect(otro.senales).toEqual(base.senales);
    const conNombre = evaluarTextoCorrupcion(CON_NOMBRE);
    expect(conNombre.puntaje).toBe(base.puntaje + PUNTOS_NOMBRE_TITULAR);
    expect(conNombre.senales).toEqual([
      ...base.senales,
      { frase: "eduardo franklin yong motta", tipo: "NOMBRE_TITULAR", peso: PUNTOS_NOMBRE_TITULAR },
    ]);
    for (const resultado of [conNombre, otro]) {
      expect(resultado.certeza).toBe(base.certeza);
      expect(resultado.propuestaCorrupcion).toBe(base.propuestaCorrupcion);
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
    expect(resultado.referenciaDerivacion).toEqual({
      codigoEntidad: "sis",
      contactosDisponibles: ["OCI", "PROCURADOR"],
      destinoSiTitular: {
        texto: DESTINO_ST_PAD,
        entidadDestinoCodigo: "st-pad-minsa",
      },
      aplicaAlTitular: false,
    });
  });

  it("la referencia lista solo los contactos que el directorio trae (FISSAL: ninguno)", () => {
    const resultado = evaluarTextoCorrupcion("En el FISSAL me pidieron plata para atenderme y tengo fotos");
    expect(resultado.referenciaDerivacion).toMatchObject({
      codigoEntidad: "fissal",
      contactosDisponibles: [],
    });
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

const DESTINO_ST_PAD = "ST PAD MINSA (Secretaría Técnica del Procedimiento Administrativo Disciplinario del MINSA)";
const DIRIS_ESTE = "DIRIS LIMA ESTE (Dirección de Redes Integradas de Salud Lima Este)";
const DIRIS_CENTRO = "DIRIS LIMA CENTRO (Dirección de Redes Integradas de Salud Lima Centro)";
const DESTINO_SIS = "SIS (Sistema Integrado de Salud, según la nota (2*) de la lista)";

describe("destino si la denuncia es contra el titular (catálogo)", () => {
  it("las 37 entidades de la nota traen destino, y el código al que apuntan existe en el catálogo o es el destino especial st-pad-minsa", () => {
    const codigos = new Set([...CATALOGO_ENTIDADES.map(({ codigo }) => codigo), CODIGO_DESTINO_ST_PAD_MINSA]);
    for (const { codigo, destinoSiTitular } of CATALOGO_ENTIDADES) {
      expect(destinoSiTitular?.texto, codigo).toBeTruthy();
      if (destinoSiTitular?.entidadDestinoCodigo) expect(codigos.has(destinoSiTitular.entidadDestinoCodigo), codigo).toBe(true);
    }
  });

  it("st-pad-minsa no es una entidad del catálogo: ninguna entidad se llama así, y las del ST PAD apuntan a él y no a minsa", () => {
    expect(CATALOGO_ENTIDADES.some(({ codigo }) => codigo === CODIGO_DESTINO_ST_PAD_MINSA)).toBe(false);
    const delStPad = CATALOGO_ENTIDADES.filter(({ destinoSiTitular }) => destinoSiTitular?.texto.startsWith("ST PAD MINSA"));
    expect(delStPad.length).toBeGreaterThan(0);
    for (const { codigo, destinoSiTitular } of delStPad)
      expect(destinoSiTitular?.entidadDestinoCodigo, codigo).toBe(CODIGO_DESTINO_ST_PAD_MINSA);
  });

  it.each([
    ["fissal", DESTINO_SIS, "sis"],
    ["inen", DESTINO_ST_PAD, "st-pad-minsa"],
    ["hhv", DIRIS_ESTE, "diris-le"],
    ["hh", DIRIS_ESTE, "diris-le"],
    ["hjatch", DIRIS_ESTE, "diris-le"],
    ["hlev", DIRIS_ESTE, "diris-le"],
    ["hnal", DIRIS_CENTRO, "diris-lc"],
    ["hejcu", DIRIS_CENTRO, "diris-lc"],
    ["honadomani-sb", DIRIS_CENTRO, "diris-lc"],
  ])("%s: el destino sale tal cual de la fuente", (codigo, texto, destino) => {
    expect(porCodigo(codigo).destinoSiTitular).toEqual({
      texto,
      entidadDestinoCodigo: destino,
    });
  });

  it("las entidades sin contactos igual traen destino (la ficha no queda vacía)", () => {
    const sinContactos = CATALOGO_ENTIDADES.filter(({ huecos }) => huecos?.includes("SIN_CONTACTOS"));
    expect(sinContactos.map(({ codigo }) => codigo).sort()).toEqual(["fissal", "hejcu", "hh", "hjatch", "honadomani-sb", "inen"]);
    for (const { codigo, destinoSiTitular } of sinContactos) expect(destinoSiTitular, codigo).not.toBeNull();
  });

  it("el MINSA manda a sus órganos, que no son una entidad del catálogo: solo texto, sin código", () => {
    expect(porCodigo("minsa").destinoSiTitular).toEqual({
      texto: "Servidores y funcionarios de todos los órganos de la administración central (excepción del Ministro)",
      entidadDestinoCodigo: null,
    });
  });
});

describe("referenciaDerivacion con destino si es el titular", () => {
  const casos = [
    ["SIS (FISSAL)", "El jefe institucional del FISSAL me pidió coima para atenderme", "fissal", DESTINO_SIS, "sis"],
    ["ST PAD MINSA (INEN)", "El jefe institucional del INEN me pidió coima para atenderme", "inen", DESTINO_ST_PAD, "st-pad-minsa"],
    [
      "DIRIS Lima Este (Hermilio Valdizán)",
      "El director general del Hospital Hermilio Valdizan me pidió coima",
      "hhv",
      DIRIS_ESTE,
      "diris-le",
    ],
    ["DIRIS Lima Centro (Loayza)", "El director general del Hospital Loayza me pidió coima", "hnal", DIRIS_CENTRO, "diris-lc"],
  ] as const;

  it.each(casos)("%s: entidad y titular detectados, aplica al titular", (_nombre, texto, codigo, destino, destinoCodigo) => {
    const resultado = evaluarTextoCorrupcion(texto);
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.titular).not.toBeNull();
    expect(resultado.referenciaDerivacion).toMatchObject({
      codigoEntidad: codigo,
      destinoSiTitular: {
        texto: destino,
        entidadDestinoCodigo: destinoCodigo,
      },
      aplicaAlTitular: true,
    });
  });

  it("la entidad sin sus contactos (FISSAL) devuelve el destino aunque contactosDisponibles esté vacío", () => {
    const { referenciaDerivacion } = evaluarTextoCorrupcion(casos[0][1]);
    expect(referenciaDerivacion?.contactosDisponibles).toEqual([]);
    expect(referenciaDerivacion?.destinoSiTitular?.texto).toBe(DESTINO_SIS);
  });

  it("solo se menciona la entidad (sin cargo máximo): el destino se informa pero aplicaAlTitular es false", () => {
    const resultado = evaluarTextoCorrupcion("En el Hospital Loayza me pidieron coima para atenderme");
    expect(resultado.titular).toBeNull();
    expect(resultado.referenciaDerivacion).toMatchObject({
      codigoEntidad: "hnal",
      destinoSiTitular: {
        texto: DIRIS_CENTRO,
        entidadDestinoCodigo: "diris-lc",
      },
      aplicaAlTitular: false,
    });
  });

  it("un cargo de línea (no máximo) tampoco cuenta como titular", () => {
    const resultado = evaluarTextoCorrupcion("El jefe de logística del Hospital Loayza me pidió coima");
    expect(resultado.titular).toBeNull();
    expect(resultado.referenciaDerivacion?.aplicaAlTitular).toBe(false);
  });

  it("entidad sin destino en la fuente: destinoSiTitular es null y aplicaAlTitular false", () => {
    const catalogo = [
      {
        codigo: "x",
        nombre: "Hospital Ficticio",
        alias: [],
        titular: {
          cargo: "Director General",
          cargosEquivalentes: [],
          nombre: null,
        },
      },
    ];
    const resultado = evaluarTextoCorrupcion("El director general del Hospital Ficticio me pidió coima", {
      entidades: catalogo,
    });
    expect(resultado.titular).not.toBeNull();
    expect(resultado.referenciaDerivacion).toEqual({
      codigoEntidad: "x",
      contactosDisponibles: [],
      destinoSiTitular: null,
      aplicaAlTitular: false,
    });
  });

  it("el destino explícito null también da null", () => {
    const catalogo = [{ codigo: "x", nombre: "Hospital Ficticio", destinoSiTitular: null }];
    const resultado = evaluarTextoCorrupcion("En el Hospital Ficticio me pidieron coima para atenderme", {
      entidades: catalogo,
    });
    expect(resultado.referenciaDerivacion).toMatchObject({
      destinoSiTitular: null,
      aplicaAlTitular: false,
    });
  });

  it("texto sin entidad del catálogo: referenciaDerivacion es null", () => {
    const resultado = evaluarTextoCorrupcion("El director general me pidió coima para atenderme en la emergencia");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.referenciaDerivacion).toBeNull();
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
