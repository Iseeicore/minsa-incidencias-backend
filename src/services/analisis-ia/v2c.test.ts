import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  FormatoSalidaIa,
  InformacionFaltanteIa,
  MotivoFalloIa,
  OrigenFundamento,
  VarianteIa,
} from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type {
  ClienteModelo,
  MetricasModelo,
  ResultadoConsulta,
} from "@/services/analisis-ia/analisis-ia.types.js";
import { crearClienteOllama } from "@/services/analisis-ia/cliente-ollama.js";
import {
  esquemaSalidaCompactaJson,
  esquemaSalidaJson,
  validarSalidaCompacta,
  type SalidaCompacta,
} from "@/services/analisis-ia/esquema-salida.js";
import {
  construirExplicacionDeterminista,
  informacionFaltanteDeReglas,
} from "@/services/analisis-ia/plantillas-paquete.js";
import {
  construirPeticion,
  PROMPT_SISTEMA,
} from "@/services/analisis-ia/prompts.js";
import { combinarReglasConIa } from "@/services/filtro-corrupcion/combinar-reglas-con-ia.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

const METRICAS: MetricasModelo = {
  intentos: 1,
  duracionMs: 5,
  totalOllamaMs: 4,
  cargaModeloMs: 1,
  procesoPromptMs: 1,
  generacionMs: 2,
  tokensPrompt: 10,
  tokensSalida: 5,
};

const compacta = (parcial: Partial<SalidaCompacta> = {}): SalidaCompacta => ({
  categoria: CategoriaIncidencia.RECLAMO,
  peso_corrupcion: 0,
  posible_corrupcion: false,
  ...parcial,
});
const clienteQue = (resultado: ResultadoConsulta): ClienteModelo => ({
  consultar: vi.fn(async () => resultado),
});
const clienteCon = (parcial: Partial<SalidaCompacta>): ClienteModelo =>
  clienteQue({ ok: true, salida: compacta(parcial), metricas: METRICAS });
const clienteCaido = clienteQue({
  ok: false,
  motivo: MotivoFalloIa.SIN_CONEXION,
  metricas: METRICAS,
});

const TEXTO_COBRO = "El director del hospital me pidió plata para atenderme";
const TEXTO_NEUTRO =
  "Quiero saber a qué hora abre la farmacia del hospital por las tardes";
const TEXTO_ZONA_GRIS =
  "El director del Hospital Dos de Mayo pide cosas a los pacientes que pagaron en caja";
const TEXTO_TITULAR =
  "La jefa del SIS, Zulma Anaya Chacón, me pidió plata para atenderme";

const sha256 = (texto: string): string =>
  createHash("sha256").update(texto).digest("hex");

describe("V1, V2 y V3 no cambian", () => {
  it("sus prompts del sistema son byte a byte los de antes de V2C", () => {
    expect(sha256(PROMPT_SISTEMA.V1)).toBe(
      "f5689423a096aabd334babe42a3a82f3d43cafb174fb5bf9bafa10986109a74f",
    );
    expect(sha256(PROMPT_SISTEMA.V2)).toBe(
      "3152469673075cb5b25b486ff6bdbbed2dedb170f8587a3f124fb83b7bdcc749",
    );
    expect(sha256(PROMPT_SISTEMA.V3)).toBe(
      "c1d418dd4f59f1e1eaa04b815c6365d2f8358c12e28dd334be57dc175c7dcfa2",
    );
  });
});

describe("esquema compacto", () => {
  it("valida tres campos y rechaza lo que no cumple", () => {
    expect(validarSalidaCompacta(compacta({ peso_corrupcion: 7 })).ok).toBe(
      true,
    );
    expect(validarSalidaCompacta({ ...compacta(), categoria: "X" }).ok).toBe(
      false,
    );
    expect(validarSalidaCompacta({ categoria: "QUEJA" }).ok).toBe(false);
    expect(
      validarSalidaCompacta({ ...compacta(), posible_corrupcion: "si" }).ok,
    ).toBe(false);
    expect(validarSalidaCompacta("texto").ok).toBe(false);
    expect(validarSalidaCompacta(null).ok).toBe(false);
  });

  it("recorta el peso fuera de rango y redondea un decimal", () => {
    const alto = validarSalidaCompacta({ ...compacta(), peso_corrupcion: 99 });
    const bajo = validarSalidaCompacta({ ...compacta(), peso_corrupcion: -4 });
    const decimal = validarSalidaCompacta({
      ...compacta(),
      peso_corrupcion: 6.6,
    });
    expect(alto.ok && alto.salida.peso_corrupcion).toBe(10);
    expect(bajo.ok && bajo.salida.peso_corrupcion).toBe(0);
    expect(decimal.ok && decimal.salida.peso_corrupcion).toBe(7);
  });

  it("el JSON Schema tiene los tres campos en orden, el enum de categorías y el entero de 0 a 10", () => {
    const esquema = esquemaSalidaCompactaJson();
    expect(esquema).not.toHaveProperty("$schema");
    const propiedades = esquema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(propiedades)).toEqual([
      "categoria",
      "peso_corrupcion",
      "posible_corrupcion",
    ]);
    expect(propiedades.categoria?.enum).toEqual(
      Object.values(CategoriaIncidencia),
    );
    expect(propiedades.peso_corrupcion).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 10,
    });
    expect(propiedades.posible_corrupcion).toMatchObject({ type: "boolean" });
    expect(esquema.required).toEqual([
      "categoria",
      "peso_corrupcion",
      "posible_corrupcion",
    ]);
  });
});

describe("prompt de V2C", () => {
  const sistema = PROMPT_SISTEMA[VarianteIa.V2C];

  it("no menciona los campos que ya no existen", () => {
    for (const eliminado of [
      "informacion_faltante",
      "alternativas",
      "senales",
      "explicacion",
      "nombre_mencionado",
    ])
      expect(sistema).not.toContain(eliminado);
    expect(sistema).not.toMatch(/\bactor\b/);
    expect(sistema).toContain("posible_corrupcion");
  });

  it("conserva los bloques de V2 y renumera las reglas duras sin huecos", () => {
    for (const bloque of [
      "CATEGORÍAS",
      "PESO_CORRUPCION",
      "PISTAS DE LAS REGLAS",
    ])
      expect(sistema).toContain(bloque);
    expect(PROMPT_SISTEMA.V2).toContain("6. No inventes datos");
    expect(sistema).not.toContain("No inventes datos");
    const reglas = sistema.split("REGLAS DURAS\n")[1]?.split("\n\n")[0] ?? "";
    expect(reglas.split("\n").map((l) => l.slice(0, 2))).toEqual([
      "1.",
      "2.",
      "3.",
      "4.",
      "5.",
      "6.",
      "7.",
    ]);
    expect(reglas).toContain("7. Responde solo el JSON");
  });

  it("el prefijo no varía entre mensajes: lo variable va solo en el mensaje del usuario", () => {
    const a = construirPeticion(
      VarianteIa.V2C,
      TEXTO_COBRO,
      evaluarTextoCorrupcion(TEXTO_COBRO),
    );
    const b = construirPeticion(
      VarianteIa.V2C,
      TEXTO_NEUTRO,
      evaluarTextoCorrupcion(TEXTO_NEUTRO),
      { establecimiento: "Hospital X" },
    );
    expect(a.sistema).toBe(b.sistema);
    expect(a.sistema).toBe(sistema);
    expect(a.formato).toBe(FormatoSalidaIa.COMPACTA);
    expect(a.usuario).toContain("Pistas de las reglas");
    expect(a.usuario).toContain(TEXTO_COBRO);
    expect(b.usuario).toContain("Hospital X");
    expect(sistema).not.toContain(TEXTO_COBRO);
  });

  it("el usuario de V2C es igual al de V2 y las otras variantes siguen pidiendo salida completa", () => {
    const reglas = evaluarTextoCorrupcion(TEXTO_COBRO);
    expect(construirPeticion(VarianteIa.V2C, TEXTO_COBRO, reglas).usuario).toBe(
      construirPeticion(VarianteIa.V2, TEXTO_COBRO, reglas).usuario,
    );
    for (const v of [VarianteIa.V1, VarianteIa.V2, VarianteIa.V3])
      expect(construirPeticion(v, TEXTO_COBRO, reglas).formato).toBe(
        FormatoSalidaIa.COMPLETA,
      );
  });
});

describe("cliente de Ollama con salida compacta", () => {
  const respuesta = (contenido: string): Response =>
    new Response(
      JSON.stringify({
        message: { content: contenido },
        total_duration: 3_000_000_000,
        eval_count: 38,
      }),
      { status: 200 },
    );
  const peticion = {
    sistema: "s",
    usuario: "u",
    formato: FormatoSalidaIa.COMPACTA,
  };
  const cuerpoDe = (
    fetchFn: ReturnType<typeof vi.fn>,
    i = 0,
  ): Record<string, unknown> =>
    JSON.parse(
      (fetchFn.mock.calls[i] as unknown as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;

  it("pide el esquema compacto con tope de generación y conserva los parámetros fijos", async () => {
    const fetchFn = vi.fn(async () =>
      respuesta(JSON.stringify(compacta({ peso_corrupcion: 7 }))),
    );
    const r = await crearClienteOllama({
      fetchFn,
      opciones: { temperature: 0, seed: 7, num_ctx: 4096 },
    }).consultar(peticion);
    expect(r.ok && r.salida.peso_corrupcion).toBe(7);
    const cuerpo = cuerpoDe(fetchFn);
    expect(cuerpo.format).toEqual(esquemaSalidaCompactaJson());
    expect(cuerpo.options).toEqual({
      temperature: 0,
      seed: 7,
      num_ctx: 4096,
      num_predict: 80,
    });
  });

  it("la salida completa no lleva tope de generación", async () => {
    const fetchFn = vi.fn(async () => respuesta("{}"));
    await crearClienteOllama({ fetchFn, reintentos: 0 }).consultar({
      sistema: "s",
      usuario: "u",
    });
    expect(cuerpoDe(fetchFn).format).toEqual(esquemaSalidaJson());
    expect(cuerpoDe(fetchFn).options).not.toHaveProperty("num_predict");
  });

  it("un JSON cortado se reintenta una vez y, si se recupera, devuelve la salida", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(respuesta('{"categoria":"QUEJA","peso_corr'))
      .mockResolvedValueOnce(respuesta(JSON.stringify(compacta())));
    const r = await crearClienteOllama({ fetchFn }).consultar(peticion);
    expect(r.ok).toBe(true);
    expect(r.metricas.intentos).toBe(2);
  });

  it("si el JSON sigue cortado o inválido, devuelve el motivo y el orquestador degrada a solo reglas", async () => {
    const cortado = vi.fn(async () => respuesta('{"categoria":"QUEJA",'));
    const r = await crearClienteOllama({ fetchFn: cortado }).consultar(
      peticion,
    );
    expect(r).toMatchObject({ ok: false, motivo: MotivoFalloIa.JSON_INVALIDO });
    expect(cortado).toHaveBeenCalledTimes(2);

    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        variante: VarianteIa.V2C,
        cliente: crearClienteOllama({
          fetchFn: async () => respuesta("{}"),
        }),
      },
    );
    expect(p).toMatchObject({
      degradado: true,
      motivoDegradado: MotivoFalloIa.ESQUEMA_INVALIDO,
      propuesta: "DENUNCIA_CORRUPCION",
    });
  });
});

describe("plantillas deterministas", () => {
  const entrada = (texto: string, salida: SalidaCompacta | null) => {
    const reglas = evaluarTextoCorrupcion(texto);
    const combinacion = combinarReglasConIa(
      reglas,
      salida ? salida.peso_corrupcion : null,
    );
    return {
      reglas,
      salida,
      combinacion,
      revisionOtrans: combinacion.revisionOtrans,
    };
  };

  it("la misma entrada da la misma explicación", () => {
    const e = entrada(TEXTO_TITULAR, compacta({ peso_corrupcion: 8 }));
    expect(construirExplicacionDeterminista(e)).toBe(
      construirExplicacionDeterminista({ ...e }),
    );
  });

  it("con entidad, titular y señales los cita; son dos frases en español", () => {
    const e = entrada(
      TEXTO_TITULAR,
      compacta({
        categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
        peso_corrupcion: 8,
        posible_corrupcion: true,
      }),
    );
    const texto = construirExplicacionDeterminista(e);
    expect(e.reglas.entidad).not.toBeNull();
    expect(e.reglas.titular).not.toBeNull();
    expect(texto).toContain("Las reglas suman");
    expect(texto).toContain(`entidad detectada: ${e.reglas.entidad?.nombre}`);
    expect(texto).toContain(`titular mencionado: ${e.reglas.titular?.cargo}`);
    expect(texto).toContain("denuncia de corrupción con peso 8 de 10");
    expect(texto).toContain("marca posible corrupción");
    expect(texto).toContain("se propone OTRANS porque las reglas la proponen");
    expect(texto.split(". ")).toHaveLength(2);
    expect(texto.endsWith(".")).toBe(true);
  });

  it("sin señales, entidad ni titular no inventa nada", () => {
    const e = entrada(TEXTO_NEUTRO, compacta({ categoria: "OTRO" }));
    const texto = construirExplicacionDeterminista(e);
    expect(texto).toContain(
      "Las reglas no encontraron señales de corrupción (0 puntos)",
    );
    expect(texto).not.toContain("entidad detectada");
    expect(texto).not.toContain("titular mencionado");
    expect(texto).not.toContain("cargo mencionado");
    expect(texto).toContain("El modelo propone otro con peso 0 de 10");
    expect(texto).toContain("no se propone OTRANS (total 0, umbral 5)");
  });

  it("solo con cargo (sin titular del catálogo) cita el cargo", () => {
    const e = entrada(TEXTO_COBRO, compacta({ peso_corrupcion: 3 }));
    const texto = construirExplicacionDeterminista(e);
    expect(texto).toMatch(/titular mencionado: |cargo mencionado: /);
  });

  it("modelo no disponible: lo dice y, en la zona gris, manda la revisión a OTRANS", () => {
    const e = entrada(TEXTO_ZONA_GRIS, null);
    const texto = construirExplicacionDeterminista(e);
    expect(texto).toContain("El modelo no estuvo disponible");
    expect(texto).toContain("OTRANS debe revisarlo por duda");
  });

  it("si el peso del modelo sube el total, lo explica con el total y el umbral", () => {
    const e = entrada(
      TEXTO_ZONA_GRIS,
      compacta({
        categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
        peso_corrupcion: 9,
        posible_corrupcion: true,
      }),
    );
    expect(e.combinacion.subidaPorIa).toBe(true);
    expect(construirExplicacionDeterminista(e)).toContain(
      `el peso del modelo lleva el total sobre el umbral (total ${e.combinacion.puntajeTotal}, umbral 5)`,
    );
  });

  it("información faltante: mapea los faltantes de las reglas a los cuatro valores", () => {
    const reglas = evaluarTextoCorrupcion(TEXTO_COBRO);
    const faltantes = informacionFaltanteDeReglas(reglas);
    expect(faltantes.length).toBe(reglas.faltantes.length);
    for (const f of faltantes)
      expect(Object.values(InformacionFaltanteIa)).toContain(f);
    expect(informacionFaltanteDeReglas({ ...reglas, faltantes: [] })).toEqual(
      [],
    );
    expect(
      informacionFaltanteDeReglas({
        ...reglas,
        faltantes: [
          "DATOS_INSUFICIENTES",
          "AUTOR_O_CARGO",
          "ENTIDAD",
          "PRUEBAS",
        ],
      }),
    ).toEqual([
      "hecho_detallado",
      "autor_o_cargo",
      "entidad_o_unidad",
      "pruebas",
    ]);
  });
});

describe("analizarMensaje con V2C", () => {
  it("arma el paquete completo sin depender del modelo", async () => {
    const cliente = clienteCon({
      categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
      peso_corrupcion: 8,
      posible_corrupcion: true,
    });
    const p = await analizarMensaje(
      TEXTO_TITULAR,
      {},
      { variante: VarianteIa.V2C, cliente },
    );
    const otra = await analizarMensaje(
      TEXTO_TITULAR,
      {},
      { variante: VarianteIa.V2C, cliente },
    );
    expect(p.explicacion).toBe(otra.explicacion);
    expect(p.explicacion).toContain("Las reglas suman");
    expect(p.fundamentos.length).toBeGreaterThan(0);
    expect(
      p.fundamentos.every((f) => f.origen === OrigenFundamento.REGLAS),
    ).toBe(true);
    expect(p.informacionFaltante).toEqual(
      informacionFaltanteDeReglas(p.reglas),
    );
    expect(p.fichaDerivacion).toMatchObject({ codigoEntidad: "sis" });
    expect(p).toMatchObject({
      propuesta: "DENUNCIA_CORRUPCION",
      variante: "V2C",
      degradado: false,
      pesoIa: 8,
      requiereOtrans: true,
      requiereRevisionHumana: true,
      sinDesempateQuejaReclamo: true,
    });
    expect(p.confianza).toBeLessThan(100);
    expect(p.confianza).toBeLessThanOrEqual(95);
  });

  it("aplica el piso de 6 cuando el modelo marca posible corrupción y nunca baja un caso de las reglas", async () => {
    const piso = await analizarMensaje(
      TEXTO_ZONA_GRIS,
      {},
      {
        variante: VarianteIa.V2C,
        cliente: clienteCon({ peso_corrupcion: 1, posible_corrupcion: true }),
      },
    );
    expect(piso.pesoIa).toBe(6);
    expect(piso.combinacion.subidaPorIa).toBe(true);

    const noBaja = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        variante: VarianteIa.V2C,
        cliente: clienteCon({
          categoria: CategoriaIncidencia.OTRO,
          peso_corrupcion: 0,
        }),
      },
    );
    expect(noBaja.reglas.propuestaCorrupcion).toBe(true);
    expect(noBaja).toMatchObject({
      propuesta: "DENUNCIA_CORRUPCION",
      requiereOtrans: true,
    });
  });

  it("sin alternativas no hay empate queja/reclamo: se respeta la categoría del modelo y se registra que no hubo desempate", async () => {
    const p = await analizarMensaje(
      TEXTO_NEUTRO,
      {},
      {
        variante: VarianteIa.V2C,
        cliente: clienteCon({ categoria: CategoriaIncidencia.QUEJA }),
      },
    );
    expect(p).toMatchObject({
      propuesta: "QUEJA",
      empateQuejaReclamo: false,
      sinDesempateQuejaReclamo: true,
    });
    expect(p.salidaModelo).toEqual(
      compacta({ categoria: CategoriaIncidencia.QUEJA }),
    );
  });

  it("modelo caído: degrada a solo reglas, con la explicación de la plantilla, sin lanzar", async () => {
    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      { variante: VarianteIa.V2C, cliente: clienteCaido },
    );
    expect(p).toMatchObject({
      degradado: true,
      motivoDegradado: MotivoFalloIa.SIN_CONEXION,
      pesoIa: null,
      propuesta: "DENUNCIA_CORRUPCION",
      sinDesempateQuejaReclamo: false,
    });
    expect(p.explicacion).toContain("El modelo no estuvo disponible");
  });

  it("texto corto: no consulta al modelo y no inventa explicación", async () => {
    const cliente = clienteCon({});
    const p = await analizarMensaje(
      "hola",
      {},
      { variante: VarianteIa.V2C, cliente },
    );
    expect(cliente.consultar).not.toHaveBeenCalled();
    expect(p).toMatchObject({
      propuesta: "OTRO",
      explicacion: null,
      variante: null,
      sinDesempateQuejaReclamo: false,
    });
  });

  it("V2 sigue usando la explicación del modelo y no marca la pérdida de desempate", async () => {
    const cliente = clienteQue({
      ok: true,
      salida: {
        ...compacta(),
        alternativas: [],
        senales: [],
        actor: { cargo: null, nombre_mencionado: null },
        informacion_faltante: ["pruebas"],
        explicacion: "Explicación del modelo.",
      },
      metricas: METRICAS,
    });
    const p = await analizarMensaje(
      TEXTO_NEUTRO,
      {},
      { variante: VarianteIa.V2, cliente },
    );
    expect(p).toMatchObject({
      explicacion: "Explicación del modelo.",
      informacionFaltante: ["pruebas"],
      sinDesempateQuejaReclamo: false,
    });
  });
});
