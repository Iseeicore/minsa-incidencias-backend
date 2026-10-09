import { describe, expect, it } from "vitest";
import {
  CertezaCorrupcion as C,
  FaltanteCorrupcion as F,
  NivelCargo,
  TipoEntidad,
  TipoSenal as T,
} from "@/enums/filtro-corrupcion.enum.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";
import type { ContextoEvaluacion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

const CATALOGO_DE_PRUEBA: ContextoEvaluacion = {
  entidades: [
    { codigo: "MINSA", nombre: "Ministerio de Salud", alias: ["ministerio", "minsa"] },
    { codigo: "SIS", nombre: "Seguro Integral de Salud", alias: ["sis"] },
  ],
};
const SIN_CATALOGO: ContextoEvaluacion = { entidades: [] };

describe("casos límite del léxico (sección 8)", () => {
  const casos: { texto: string; propuesta: boolean; certeza: C; puntaje: number }[] = [
    { texto: "El director no me quiso atender", propuesta: false, certeza: C.BAJA, puntaje: 0 },
    { texto: "Me cobraron 50 soles sin recibo para darme la cita", propuesta: true, certeza: C.ALTA, puntaje: 5 },
    { texto: "Pagué 20 soles en caja y me dieron boleta", propuesta: false, certeza: C.BAJA, puntaje: -2 },
    { texto: "No hay medicinas en la farmacia", propuesta: false, certeza: C.BAJA, puntaje: -1 },
    // Puntaje 5 y no 4: "SIS" es una entidad del catálogo y suma +1 (léxico, sección 2). La propuesta y la certeza no cambian.
    { texto: "La enfermera vende las medicinas del SIS", propuesta: true, certeza: C.ALTA, puntaje: 5 },
    { texto: "Mi médico me derivó a su clínica particular", propuesta: true, certeza: C.MEDIA, puntaje: 3 },
    { texto: "Contrataron a la sobrina del director", propuesta: true, certeza: C.ALTA, puntaje: 4 },
    { texto: "Me robaron el celular en emergencia", propuesta: false, certeza: C.BAJA, puntaje: -2 },
    { texto: "Quiero denunciar el mal trato", propuesta: false, certeza: C.BAJA, puntaje: -1 },
    { texto: "El jefe de logística favoreció a una empresa", propuesta: true, certeza: C.ALTA, puntaje: 4 },
    { texto: "Falta disciplinaria o ética sin beneficio indebido", propuesta: false, certeza: C.BAJA, puntaje: 0 },
  ];

  it.each(casos)("$texto", ({ texto, propuesta, certeza, puntaje }) => {
    const resultado = evaluarTextoCorrupcion(texto);
    expect(resultado.aplica).toBe(true);
    expect(resultado.propuestaCorrupcion).toBe(propuesta);
    expect(resultado.certeza).toBe(certeza);
    expect(resultado.puntaje).toBe(puntaje);
  });

  it("con el catálogo desactivado solo el SIS cambia de puntaje, y solo en +1: la categoría y la certeza son las mismas", () => {
    for (const { texto, propuesta, certeza, puntaje } of casos) {
      const sin = evaluarTextoCorrupcion(texto, SIN_CATALOGO);
      expect(sin.propuestaCorrupcion).toBe(propuesta);
      expect(sin.certeza).toBe(certeza);
      expect(sin.puntaje).toBe(texto.includes("SIS") ? puntaje - 1 : puntaje);
    }
  });
});

describe("ejemplo del ministro (plan de cierre, 3b)", () => {
  const texto =
    "he presenciado un caso de corrupción en el área del Ministerio del Perú, vi al ministro de salud Luis Williams Dyer Fernández y lo vi recibiendo coimas";

  it('v1.2: "Ministerio" suelto ya no es el MINSA: suma coimas (+3), corrupción (+1) y ministro de salud (+1) = 5, certeza alta', () => {
    const resultado = evaluarTextoCorrupcion(texto);
    expect(resultado.puntaje).toBe(5);
    expect(resultado.certeza).toBe(C.ALTA);
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.senales).toEqual([
      { frase: "corrupcion", tipo: T.DEBIL, peso: 1 },
      { frase: "coimas", tipo: T.FUERTE, peso: 3 },
      { frase: "ministro de salud", tipo: T.ACTOR, peso: 1 },
    ]);
    expect(resultado.actor).toEqual({ cargo: "ministro de salud", nivel: NivelCargo.CARGO_MAXIMO });
    expect(resultado.titular).toEqual({ cargo: "ministro de salud", esEquivalenteDelMaximo: true, nombreCoincide: false });
    expect(resultado.entidad).toBeNull();
    expect(resultado.nombreMencionado).toBe("Luis Williams Dyer Fernández");
    expect(resultado.versionReglas).toBe("reglas-corrupcion-v1.2");
  });

  it('si el texto dice "Ministerio de Salud" o MINSA, sí suma la entidad (+1 = 6)', () => {
    for (const nombre of ["Ministerio de Salud", "MINSA"]) {
      const resultado = evaluarTextoCorrupcion(texto.replace("Ministerio del Perú", nombre));
      expect(resultado.puntaje).toBe(6);
      expect(resultado.entidad).toEqual({ codigo: "minsa", nombre: "Ministerio de Salud", tipo: TipoEntidad.MINISTERIO });
    }
  });

  it("con un catálogo recibido por el contexto se usa ese y no el oficial", () => {
    const resultado = evaluarTextoCorrupcion(texto, CATALOGO_DE_PRUEBA);
    expect(resultado.puntaje).toBe(6);
    expect(resultado.entidad).toEqual({ codigo: "MINSA", nombre: "Ministerio de Salud", tipo: null });
  });

  it("con el catálogo vacío no hay entidad ni su punto", () => {
    const resultado = evaluarTextoCorrupcion("vi al MINSA recibiendo coimas en el hospital", SIN_CATALOGO);
    expect(resultado.entidad).toBeNull();
    expect(resultado.puntaje).toBe(3);
  });

  it("el nombre propio es informativo: quitarlo o cambiarlo no cambia puntaje ni categoría", () => {
    const base = evaluarTextoCorrupcion("vi al ministro de salud recibiendo coimas ayer", CATALOGO_DE_PRUEBA);
    const conNombre = evaluarTextoCorrupcion("vi al ministro de salud Pedro Pérez Gómez recibiendo coimas ayer", CATALOGO_DE_PRUEBA);
    const otroNombre = evaluarTextoCorrupcion("vi al ministro de salud Ana Torres Ruiz recibiendo coimas ayer", CATALOGO_DE_PRUEBA);
    for (const resultado of [conNombre, otroNombre]) {
      expect(resultado.puntaje).toBe(base.puntaje);
      expect(resultado.certeza).toBe(base.certeza);
      expect(resultado.propuestaCorrupcion).toBe(base.propuestaCorrupcion);
      expect(resultado.senales).toEqual(base.senales);
    }
    expect(base.nombreMencionado).toBeNull();
    expect(conNombre.nombreMencionado).toBe("Pedro Pérez Gómez");
    expect(otroNombre.nombreMencionado).toBe("Ana Torres Ruiz");
  });

  it("un nombre sin ninguna señal tampoco propone corrupción", () => {
    const resultado = evaluarTextoCorrupcion("Me atendió el doctor Juan Carlos Medina en consulta externa", CATALOGO_DE_PRUEBA);
    expect(resultado.nombreMencionado).toBe("Juan Carlos Medina");
    expect(resultado.propuestaCorrupcion).toBe(false);
  });
});

describe("texto corto", () => {
  it("menos de 20 caracteres: no aplica y falta información", () => {
    const resultado = evaluarTextoCorrupcion("me pidieron coima");
    expect(resultado).toMatchObject({
      aplica: false,
      puntaje: 0,
      certeza: C.BAJA,
      propuestaCorrupcion: false,
      senales: [],
      faltantes: [F.DATOS_INSUFICIENTES],
      versionReglas: "reglas-corrupcion-v1.2",
    });
  });

  it("el largo se mide con trim: espacios alrededor no completan los 20 caracteres", () => {
    expect(evaluarTextoCorrupcion("   me pidieron coima   ").aplica).toBe(false);
    expect(evaluarTextoCorrupcion("").faltantes).toEqual([F.DATOS_INSUFICIENTES]);
  });

  it("20 caracteres exactos ya entran al filtro", () => {
    const texto = "pidieron coimas aqui";
    expect(texto).toHaveLength(20);
    expect(evaluarTextoCorrupcion(texto).aplica).toBe(true);
  });
});

describe("normalización", () => {
  it("mayúsculas, tildes y signos no cambian el resultado", () => {
    const base = evaluarTextoCorrupcion("me pidieron plata para atenderme en la emergencia");
    const sucio = evaluarTextoCorrupcion("¡ME PIDIERON... PLATA, PARA ATENDERME!!! en la emergencia");
    expect(sucio.senales).toEqual(base.senales);
    expect(sucio.puntaje).toBe(3);
  });

  it("encuentra la frase con tildes en el texto aunque el léxico no las lleve", () => {
    const resultado = evaluarTextoCorrupcion("Compraron cosas con LICITACIÓN dirigida en el hospital");
    expect(resultado.senales).toEqual([{ frase: "licitacion dirigida", tipo: T.FUERTE, peso: 3 }]);
  });

  it("los montos no cortan una frase", () => {
    const resultado = evaluarTextoCorrupcion("me cobraron S/ 50 soles sin recibo para darme la cita");
    expect(resultado.puntaje).toBe(5);
  });
});

describe("reglas de decisión", () => {
  it("la palabra denuncia no es señal", () => {
    const resultado = evaluarTextoCorrupcion("Quiero poner una denuncia contra el hospital por favor");
    expect(resultado.senales).toEqual([]);
    expect(resultado.propuestaCorrupcion).toBe(false);
  });

  it("cobro, pago y abuso sueltos tampoco son señal", () => {
    const resultado = evaluarTextoCorrupcion("hubo un cobro, un pago y un abuso en la consulta de hoy");
    expect(resultado.senales).toEqual([]);
    expect(resultado.puntaje).toBe(0);
  });

  it("una señal débil sola nunca basta", () => {
    const resultado = evaluarTextoCorrupcion("la atención del hospital es una corrupción total");
    expect(resultado.puntaje).toBe(1);
    expect(resultado.propuestaCorrupcion).toBe(false);
    expect(resultado.certeza).toBe(C.BAJA);
  });

  it("sin señal no se propone corrupción aunque el actor y la entidad sumen", () => {
    const resultado = evaluarTextoCorrupcion("El director del hospital del Ministerio de Salud no me atendió bien hoy");
    expect(resultado.actor?.cargo).toBe("director del hospital");
    expect(resultado.entidad?.codigo).toBe("minsa");
    expect(resultado.puntaje).toBe(2);
    expect(resultado.propuestaCorrupcion).toBe(false);
    expect(resultado.certeza).toBe(C.BAJA);
    expect(resultado.faltantes).toEqual([]);
  });

  it("una señal media sola llega a 2: corrupción con certeza media (revisar con cuidado)", () => {
    const resultado = evaluarTextoCorrupcion("hay trato preferencial para algunos pacientes del hospital");
    expect(resultado.puntaje).toBe(2);
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.certeza).toBe(C.MEDIA);
  });

  it("la negativa decisiva resta: pagué en caja y me dieron boleta cuenta una sola vez", () => {
    const resultado = evaluarTextoCorrupcion("pagué en caja y me dieron boleta por la consulta");
    expect(resultado.senales).toEqual([{ frase: "pague en caja", tipo: T.NEGATIVA_DECISIVA, peso: -2 }]);
    expect(resultado.puntaje).toBe(-2);
    expect(resultado.propuestaCorrupcion).toBe(false);
  });

  it("una negativa decisiva deja la corrupción por debajo de 2", () => {
    const resultado = evaluarTextoCorrupcion("me pidieron plata para atenderme pero pagué en caja y me dieron boleta");
    expect(resultado.puntaje).toBe(1);
    expect(resultado.propuestaCorrupcion).toBe(false);
  });

  it("una negativa leve resta uno", () => {
    const resultado = evaluarTextoCorrupcion("hubo mala atención y mucha cola, y dicen que hay mafia");
    expect(resultado.senales.map(({ tipo }) => tipo)).toEqual([T.NEGATIVA_LEVE, T.DEBIL]);
    expect(resultado.puntaje).toBe(0);
  });

  it("una pago legítimo negado (no me dieron boleta) no resta", () => {
    const resultado = evaluarTextoCorrupcion("pagué algo y no me dieron boleta de nada");
    expect(resultado.senales).toEqual([]);
  });

  it("la misma frase repetida cuenta una vez y una frase corta dentro de una larga no se suma dos veces", () => {
    expect(evaluarTextoCorrupcion("coima, coima y más coima en el hospital").puntaje).toBe(3);
    expect(evaluarTextoCorrupcion("la técnica vende las medicinas del SIS a diario").puntaje).toBe(5); // 3 + técnica 1 + SIS 1
  });

  it("el hueco de la frase tolera hasta tres palabras en medio, no más", () => {
    expect(evaluarTextoCorrupcion("usan la ambulancia del hospital para uso personal siempre").puntaje).toBe(3);
    expect(evaluarTextoCorrupcion("usan la ambulancia que es de todos los vecinos para uso personal").puntaje).toBe(0);
  });

  it("detecta el cargo de mayor nivel aunque aparezca después", () => {
    const resultado = evaluarTextoCorrupcion("el cajero recibe coimas y el director general lo sabe");
    expect(resultado.actor).toEqual({ cargo: "director general", nivel: NivelCargo.CARGO_MAXIMO });
    expect(resultado.puntaje).toBe(4);
  });
});

describe("faltantes (plan de cierre, 3c)", () => {
  it("pide autor, entidad y pruebas cuando el texto no los trae", () => {
    const resultado = evaluarTextoCorrupcion("me pidieron plata para atenderme en la emergencia");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.faltantes).toEqual([F.AUTOR_O_CARGO, F.ENTIDAD, F.PRUEBAS]);
  });

  it("el cargo, la entidad del catálogo y la mención de pruebas los dan por cumplidos", () => {
    const resultado = evaluarTextoCorrupcion("el médico del Ministerio de Salud me pidió plata para atenderme y tengo fotos");
    expect(resultado.propuestaCorrupcion).toBe(true);
    expect(resultado.faltantes).toEqual([]);
  });

  it("el establecimiento conocido por el QR y los archivos subidos también cuentan", () => {
    const resultado = evaluarTextoCorrupcion("me pidieron plata para atenderme en la emergencia", {
      establecimientoConocido: true,
      tieneArchivos: true,
    });
    expect(resultado.faltantes).toEqual([F.AUTOR_O_CARGO]);
  });

  it("un nombre propio basta como autor aunque no haya cargo", () => {
    const resultado = evaluarTextoCorrupcion("Juan Carlos Medina me pidió plata para atenderme en admisión", {
      establecimientoConocido: true,
    });
    expect(resultado.actor).toBeNull();
    expect(resultado.faltantes).toEqual([F.PRUEBAS]);
  });

  it("si no se propone corrupción no hay faltantes que pedir", () => {
    expect(evaluarTextoCorrupcion("No hay medicinas en la farmacia del hospital").faltantes).toEqual([]);
  });
});
