import { describe, expect, it } from "vitest";
import {
  PUNTOS_IDENTIDAD_PARA_OTRANS,
  PUNTOS_NOMBRE_TITULAR,
  PUNTOS_UBICACION,
  TOPE_PUNTOS_IDENTIDAD,
} from "@/constants/filtro-corrupcion.js";
import { CertezaCorrupcion as C, OrigenPropuesta, TipoSenal as T, ViaEntidad } from "@/enums/filtro-corrupcion.enum.js";
import { CATALOGO_ENTIDADES } from "@/services/filtro-corrupcion/catalogo-entidades.data.js";
import { aporteDeIdentidad, evaluarTextoCorrupcion, puntosDeIdentidad } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";
import { normalizarTexto } from "@/services/filtro-corrupcion/normalizar-texto.js";
import { UBICACIONES_ENTIDADES } from "@/services/filtro-corrupcion/ubicaciones-entidades.data.js";

const entidadDe = (texto: string, contexto = {}) => evaluarTextoCorrupcion(texto, contexto).entidad?.codigo ?? null;

describe("alias derivados de las entidades", () => {
  it.each([
    ["en el loaiza piden coima a todos", "hnal"],
    ["en el loayza piden coima a todos", "hnal"],
    ["EN EL ULLOA PIDEN COIMA A TODOS", "hejcu"],
    ["el director del ulloa piden coima", "hejcu"],
    ["fui al hermilio baldizan y piden coima", "hhv"],
    ["el baldizan es un negociado de coimas", "hhv"],
    ["en el fisal piden coima a todos", "fissal"],
    ["en el fissal piden coima a todos", "fissal"],
    ["en las neoplásicas piden coima a todos", "inen"],
    ["en las neoplasicas piden coima a todos", "inen"],
    ["en el sergio bernales piden coima", "hnseb"],
    ["en el dos de mayo piden coima", "hndm"],
    ["en el honadomani piden coima", "honadomani-sb"],
    ["en el hospital huaican piden coima", "hh"],
    ["en el hospital de huaycán piden coima", "hh"],
    ["la diris de lima este pidio coima", "diris-le"],
    ["en el hospital unanue piden coima", "hnhu"],
    ["en el larco herrera piden coima", "hvlh"],
    ["en el cayetano heredia piden coima", "hnch"],
    ["en el instituto de oftalmologia piden coima", "ino"],
    ["en el hospital tello de chosica piden coima", "hjatch"],
  ])("«%s» identifica a %s", (texto, codigo) => {
    expect(entidadDe(texto)).toBe(codigo);
  });

  it("una palabra común, corta o ambigua no elige entidad por sí sola", () => {
    for (const texto of [
      "vivo en ate y me piden coima", // palabra común y distrito
      "en lima piden coima a todos",
      "en san juan piden coima a todos",
      "mi hh de la oficina pide coima", // sigla corta sin punto
      "en el sistema de salud piden coima", // «sis» dentro de otra palabra
      "la crisis del hospital y las coimas", // «sis» al final de una palabra
      "la diris pidio coima a mi mama", // cuatro DIRIS: sin zona no se sabe cuál
      "en la diris le piden coima a todos", // «DIRIS LE» no es alias: «le» es un pronombre
      "la señora heredia me pidio coima", // el apellido suelto no basta: va con artículo
      "mi amigo mayo me conto que piden coima", // «mayo» solo no es el hospital
      "en lima este piden coima a todos", // DIRIS Lima Este y el Hospital de Lima Este: ambiguo
      "en el instituto del niño piden coima", // Breña o San Borja
      "en el hospital de emergencias piden coima", // tres hospitales de emergencias
    ])
      expect(entidadDe(texto), texto).toBeNull();
  });

  it("«el dos de mayo» sí es el hospital, pero un «dos de mayo» sin artículo no", () => {
    expect(entidadDe("el dos de mayo piden coima a todos los dias")).toBe("hndm");
    expect(entidadDe("el feriado fue dos de mayo y piden coima")).toBeNull();
  });

  it("las variantes respetan los límites de palabra: no hay coincidencia dentro de otra palabra", () => {
    for (const texto of ["el loaizano piden coima", "el ulloares piden coima", "los fisalitos piden coima", "en baldizanes piden coima"])
      expect(entidadDe(texto), texto).toBeNull();
  });

  describe("el catálogo generado", () => {
    const todas = CATALOGO_ENTIDADES.flatMap((e) =>
      [e.nombre, ...(e.alias ?? []), ...(e.aliasDerivados ?? [])].map((forma) => ({ codigo: e.codigo, forma: normalizarTexto(forma) })),
    );

    it("trae alias derivados y ninguno es de una letra ni de menos de tres caracteres", () => {
      expect(CATALOGO_ENTIDADES.flatMap((e) => e.aliasDerivados ?? []).length).toBeGreaterThan(100);
      for (const { codigo, forma } of todas) {
        expect(forma.replace(/ /g, "").length, `${codigo}: ${forma}`).toBeGreaterThanOrEqual(3);
        expect(
          forma.split(" ").some((p) => p.length === 1 && !["y"].includes(p) && forma.split(" ").length === 1),
          forma,
        ).toBe(false);
      }
    });

    it("ninguna forma de nombrar pertenece a dos entidades (ni derivada ni a mano)", () => {
      const duenos = new Map<string, string>();
      for (const { codigo, forma } of todas) {
        const otro = duenos.get(forma);
        expect(otro === undefined || otro === codigo, `«${forma}» es de ${otro} y de ${codigo}`).toBe(true);
        duenos.set(forma, codigo);
      }
    });

    it("las palabras comunes y los topónimos nunca son un alias de una sola palabra", () => {
      const prohibidas = new Set([
        "ate",
        "lima",
        "san",
        "santa",
        "hh",
        "mayo",
        "rosa",
        "salud",
        "hospital",
        "instituto",
        "nacional",
        "diris",
        "chosica",
        "huaycan",
        "vitarte",
      ]);
      for (const { codigo, forma } of todas) expect(prohibidas.has(forma), `${codigo}: ${forma}`).toBe(false);
    });
  });
});

describe("nombre del titular", () => {
  const SIN_INDICIO = "no me atendieron bien en consulta ayer por la tarde";

  it("el nombre coincide (nombre y apellido, en cualquier orden): identifica la entidad aunque no se mencione y suma PUNTOS_NOMBRE_TITULAR", () => {
    for (const nombre of ["Eduardo Franklin Yong Motta", "Yong Motta Eduardo", "Eduardo Yong", "yong motta"]) {
      const resultado = evaluarTextoCorrupcion(`${nombre} me pidió plata para atenderme en consulta`);
      expect(resultado.entidad?.codigo, nombre).toBe("hnal");
      expect(resultado.identidad, nombre).toMatchObject({ nombreCoincide: true, viaEntidad: ViaEntidad.NOMBRE_TITULAR });
      expect(
        resultado.senales.filter(({ tipo }) => tipo === T.NOMBRE_TITULAR),
        nombre,
      ).toHaveLength(1);
      expect(resultado.puntaje, nombre).toBe(3 + PUNTOS_NOMBRE_TITULAR);
    }
  });

  it("con la entidad nombrada también suma, y el titular nombrado sin cargo sale en la identidad", () => {
    const resultado = evaluarTextoCorrupcion("En el Hospital Loayza, Eduardo Franklin Yong Motta me pidió plata para atenderme");
    expect(resultado.identidad).toMatchObject({ nombreCoincide: true, viaEntidad: ViaEntidad.NOMBRE_O_ALIAS });
    expect(resultado.identidad.titular).toMatchObject({ esEquivalenteDelMaximo: false, nombreCoincide: true });
    expect(resultado.identidad.titular?.cargo).toMatch(/^Director General/);
    expect(resultado.titular).toBeNull(); // el campo de siempre sigue exigiendo el cargo en el texto
    expect(resultado.puntaje).toBe(3 + 1 + PUNTOS_NOMBRE_TITULAR);
  });

  it("un nombre parcial o ficticio parecido no es coincidencia", () => {
    for (const nombre of [
      "Eduardo", // un nombre de pila suelto
      "Motta", // un apellido suelto
      "Eduardo Franklin", // dos nombres de pila
      "Eduardo Pérez Gómez", // comparte solo el nombre de pila
      "Pedro Yong", // comparte solo el apellido
      "Franklin Pérez Motta", // las palabras no van seguidas
      "Juan Manuel Pérez", // parecido a «Juan Manuel Sifuentes Monge» (INCN): comparte dos nombres de pila
    ]) {
      const resultado = evaluarTextoCorrupcion(`${nombre} me pidió plata para atenderme en consulta`);
      expect(resultado.identidad.nombreCoincide, nombre).toBe(false);
      expect(resultado.entidad, nombre).toBeNull();
      expect(
        resultado.senales.some(({ tipo }) => tipo === T.NOMBRE_TITULAR),
        nombre,
      ).toBe(false);
    }
  });

  it("el nombre del titular de otra entidad no cuenta si el texto nombra una entidad", () => {
    const resultado = evaluarTextoCorrupcion("En el SIS, Eduardo Franklin Yong Motta me pidió plata para atenderme");
    expect(resultado.entidad?.codigo).toBe("sis");
    expect(resultado.identidad.nombreCoincide).toBe(false);
  });

  it("sin indicio de corrupción el nombre del titular NO cambia la categoría", () => {
    const sin = evaluarTextoCorrupcion(`El Hospital Loayza ${SIN_INDICIO}`);
    const con = evaluarTextoCorrupcion(`Eduardo Franklin Yong Motta del Hospital Loayza ${SIN_INDICIO}`);
    const soloNombre = evaluarTextoCorrupcion(`Eduardo Franklin Yong Motta ${SIN_INDICIO}`);
    for (const resultado of [sin, con, soloNombre]) {
      expect(resultado.propuestaCorrupcion).toBe(false);
      expect(resultado.origenPropuesta).toBeNull();
      expect(resultado.certeza).toBe(C.BAJA);
      expect(resultado.requiereOtrans).toBe(false);
    }
    expect(con.identidad.nombreCoincide).toBe(true);
    expect(soloNombre.identidad.puntos).toBeGreaterThanOrEqual(PUNTOS_IDENTIDAD_PARA_OTRANS);
  });
});

describe("ubicación", () => {
  it("suma PUNTOS_UBICACION una sola vez cuando el texto no nombra la entidad", () => {
    const resultado = evaluarTextoCorrupcion("En Miraflores, en Miraflores y en Surquillo piden coima a los pacientes");
    expect(resultado.entidad).toBeNull();
    expect(resultado.senales.filter(({ tipo }) => tipo === T.UBICACION)).toEqual([
      { frase: "miraflores", tipo: T.UBICACION, peso: PUNTOS_UBICACION },
    ]);
    expect(resultado.identidad.ubicacion).toEqual({ zona: "Miraflores", codigoEntidad: "hejcu" });
    expect(resultado.puntaje).toBe(3 + PUNTOS_UBICACION);
  });

  it.each([
    ["Huaycán", "hh"],
    ["Vitarte", "hlev"],
    ["Surquillo", "inen"],
    ["Santa Anita", "hhv"],
    ["Chosica", "hjatch"],
    ["San Juan de Miraflores", "hma"],
  ])("«%s» apunta a %s", (zona, codigo) => {
    const resultado = evaluarTextoCorrupcion(`Allá en ${zona} piden coima a los pacientes`);
    expect(resultado.identidad.ubicacion).toEqual({
      zona: UBICACIONES_ENTIDADES.find((u) => u.codigoEntidad === codigo)?.zona,
      codigoEntidad: codigo,
    });
    expect(resultado.entidad).toBeNull(); // la ubicación es aproximada: no identifica la entidad
  });

  it("no se acumula con la entidad: si el texto nombra la entidad (o a su titular) la ubicación no suma", () => {
    const porAlias = evaluarTextoCorrupcion("En el Hospital Loayza, en Miraflores, piden coima a los pacientes");
    expect(porAlias.identidad.ubicacion).toBeNull();
    expect(porAlias.senales.some(({ tipo }) => tipo === T.UBICACION)).toBe(false);
    const porNombre = evaluarTextoCorrupcion("Eduardo Franklin Yong Motta en Miraflores pide coima a los pacientes");
    expect(porNombre.identidad.ubicacion).toBeNull();
  });

  it("una palabra común como «Ate» o una zona omitida no cuentan", () => {
    for (const zona of ["Ate", "Breña", "Lima", "Comas", "Lurigancho"])
      expect(evaluarTextoCorrupcion(`En ${zona} piden coima a los pacientes`).identidad.ubicacion, zona).toBeNull();
  });

  it("Chosica también es el establecimiento del QR: con establecimiento conocido no se suma; sin él sí", () => {
    const texto = "En Chosica piden coima a los pacientes";
    expect(evaluarTextoCorrupcion(texto).identidad.ubicacion?.codigoEntidad).toBe("hjatch");
    expect(evaluarTextoCorrupcion(texto, { establecimientoConocido: true }).identidad.ubicacion).toBeNull();
    expect(
      evaluarTextoCorrupcion("En Miraflores piden coima a los pacientes", { establecimientoConocido: true }).identidad.ubicacion,
    ).not.toBeNull();
  });

  it("no identifica por sí sola un cargo y sin la entidad en el catálogo recibido no suma", () => {
    const resultado = evaluarTextoCorrupcion("En Surquillo el médico me pidió coima en consulta");
    expect(resultado.titular).toBeNull();
    expect(resultado.identidad.titular).toBeNull();
    expect(evaluarTextoCorrupcion("En Surquillo piden coima a los pacientes", { entidades: [] }).identidad.ubicacion).toBeNull();
  });
});

describe("tope de la identidad", () => {
  it("el aporte de identidad al puntaje no pasa de TOPE_PUNTOS_IDENTIDAD", () => {
    const senal = (tipo: (typeof T)[keyof typeof T], peso: number) => ({ frase: "x", tipo, peso });
    expect(TOPE_PUNTOS_IDENTIDAD).toBe(4);
    expect(aporteDeIdentidad([senal(T.ENTIDAD, 1), senal(T.ACTOR, 1), senal(T.NOMBRE_TITULAR, 2)])).toBe(4);
    expect(aporteDeIdentidad([senal(T.ENTIDAD, 1), senal(T.ACTOR, 1), senal(T.NOMBRE_TITULAR, 5), senal(T.UBICACION, 3)])).toBe(
      TOPE_PUNTOS_IDENTIDAD,
    );
    // Lo que no es identidad no entra al tope.
    expect(aporteDeIdentidad([senal(T.FUERTE, 3), senal(T.DEBIL, 1), senal(T.ENTIDAD, 1)])).toBe(1);
  });

  it("los puntos de identidad también tienen tope", () => {
    expect(puntosDeIdentidad({ hayEntidadNombrada: true, hayCargo: true, nombreCoincide: true, hayUbicacion: false })).toBe(4);
    expect(puntosDeIdentidad({ hayEntidadNombrada: true, hayCargo: true, nombreCoincide: true, hayUbicacion: true })).toBe(
      TOPE_PUNTOS_IDENTIDAD,
    );
    expect(puntosDeIdentidad({ hayEntidadNombrada: false, hayCargo: false, nombreCoincide: false, hayUbicacion: false })).toBe(0);
  });

  it("entidad + titular + nombre llegan al tope y nunca lo pasan", () => {
    const resultado = evaluarTextoCorrupcion(
      "El director general del Hospital Loayza, Eduardo Franklin Yong Motta, me pidió coima en Miraflores",
    );
    expect(resultado.identidad.puntos).toBe(TOPE_PUNTOS_IDENTIDAD);
    expect(resultado.puntaje).toBe(3 + TOPE_PUNTOS_IDENTIDAD);
  });
});

describe("identidad + indicio: propuesta con certeza baja para OTRANS", () => {
  it("entidad + titular + verbo de cobro sin frase del léxico (zona gris): propone con origen IDENTIDAD y pide segunda opinión", () => {
    const resultado = evaluarTextoCorrupcion("El director del loaiza cobra cosas a los pacientes que llegan");
    expect(resultado).toMatchObject({
      propuestaCorrupcion: true,
      origenPropuesta: OrigenPropuesta.IDENTIDAD,
      certeza: C.BAJA,
      requiereOtrans: true,
      requiereSegundaOpinion: true,
    });
    expect(resultado.identidad).toMatchObject({ puntos: 2, entidad: { codigo: "hnal" }, viaEntidad: ViaEntidad.NOMBRE_O_ALIAS });
    expect(resultado.referenciaDerivacion?.codigoEntidad).toBe("hnal");
    expect(resultado.puntaje).toBeLessThan(4);
  });

  it("identidad + señal débil con puntaje muy bajo (mala atención resta): también va a OTRANS, sin segunda opinión", () => {
    const resultado = evaluarTextoCorrupcion("Mala atención, dicen que hay mafia con el gerente del Hospital Loayza");
    expect(resultado.puntaje).toBe(1);
    expect(resultado).toMatchObject({
      propuestaCorrupcion: true,
      origenPropuesta: OrigenPropuesta.IDENTIDAD,
      certeza: C.BAJA,
      requiereOtrans: true,
    });
    expect(resultado.requiereSegundaOpinion).toBe(false);
  });

  it("el nombre del titular + un verbo de cobro bastan (el nombre identifica la entidad)", () => {
    const resultado = evaluarTextoCorrupcion("Eduardo Franklin Yong Motta pide cosas a los pacientes que llegan al hospital");
    expect(resultado).toMatchObject({ propuestaCorrupcion: true, origenPropuesta: OrigenPropuesta.IDENTIDAD, certeza: C.BAJA });
    expect(resultado.entidad?.codigo).toBe("hnal");
  });

  it("identidad sin NINGÚN indicio no propone corrupción: las quejas contra un hospital siguen yendo al establecimiento", () => {
    for (const texto of [
      "El director del Hospital Dos de Mayo atendio tarde a mi mama ayer",
      "Eduardo Franklin Yong Motta no me atendió bien en consulta externa",
      "En el loaiza el gerente me trató mal en la ventanilla de citas",
      "Mala atención y mucha demora en el Hospital Loayza, el director no aparece",
    ]) {
      const resultado = evaluarTextoCorrupcion(texto);
      expect(resultado.propuestaCorrupcion, texto).toBe(false);
      expect(resultado.origenPropuesta, texto).toBeNull();
      expect(resultado.requiereOtrans, texto).toBe(false);
    }
  });

  it("con poca identidad (un solo punto) el indicio solo tampoco basta", () => {
    const resultado = evaluarTextoCorrupcion("Una enfermera del Hospital Dos de Mayo pide que esperemos afuera");
    expect(resultado.identidad.puntos).toBeLessThan(PUNTOS_IDENTIDAD_PARA_OTRANS);
    expect(resultado.propuestaCorrupcion).toBe(false);
  });

  it("una negativa decisiva (boleta, recibo, tarifario, caja) gana sobre la identidad", () => {
    for (const cierre of ["y me dieron boleta", "con recibo", "segun el tarifario", "que pagaron en caja"]) {
      const resultado = evaluarTextoCorrupcion(`El director del Hospital Dos de Mayo pide cosas a los pacientes ${cierre}`);
      expect(resultado.propuestaCorrupcion, cierre).toBe(false);
      expect(resultado.requiereSegundaOpinion, cierre).toBe(true);
    }
  });

  it("si las reglas ya proponen, el origen es REGLAS y la certeza no baja", () => {
    const resultado = evaluarTextoCorrupcion("El director del Hospital Dos de Mayo me pidio plata para darme la cama");
    expect(resultado).toMatchObject({ propuestaCorrupcion: true, origenPropuesta: OrigenPropuesta.REGLAS });
    expect(resultado.certeza).not.toBe(C.BAJA);
  });

  it("«recibo» y «me dieron boleta/recibo» son pagos legítimos y restan", () => {
    const sin = evaluarTextoCorrupcion("el doctor cobra por un certificado en el hospital de la zona");
    const con = evaluarTextoCorrupcion("el doctor cobra por un certificado pero me dio recibo en el hospital de la zona");
    expect(con.senales.some(({ tipo }) => tipo === T.NEGATIVA_DECISIVA)).toBe(true);
    expect(con.puntaje).toBe(sin.puntaje - 2);
    expect(
      evaluarTextoCorrupcion("me cobraron 30 soles por el hemograma y me dieron boleta").senales.some(
        ({ tipo }) => tipo === T.NEGATIVA_DECISIVA,
      ),
    ).toBe(true);
    // Un pago legítimo negado no resta.
    expect(
      evaluarTextoCorrupcion("me cobraron 30 soles por el hemograma y no me dieron recibo").senales.some(
        ({ tipo }) => tipo === T.NEGATIVA_DECISIVA,
      ),
    ).toBe(false);
  });

  it("texto corto: identidad neutra", () => {
    expect(evaluarTextoCorrupcion("loaiza coima").identidad).toEqual({
      puntos: 0,
      entidad: null,
      viaEntidad: null,
      titular: null,
      nombreCoincide: false,
      ubicacion: null,
    });
  });
});
