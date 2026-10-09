import { afterEach, describe, expect, it, vi } from "vitest";
import { MotivoFalloIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import {
  analizarMensaje,
  hayEmpateQuejaReclamo,
} from "@/services/analisis-ia/analizar-mensaje.js";
import type {
  ClienteModelo,
  MetricasModelo,
  ResultadoConsulta,
} from "@/services/analisis-ia/analisis-ia.types.js";
import { crearClienteOllama } from "@/services/analisis-ia/cliente-ollama.js";
import {
  esquemaSalidaJson,
  validarSalidaModelo,
  type SalidaModelo,
} from "@/services/analisis-ia/esquema-salida.js";
import {
  construirPeticion,
  PROMPT_SISTEMA,
} from "@/services/analisis-ia/prompts.js";
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

const salida = (parcial: Partial<SalidaModelo> = {}): SalidaModelo => ({
  categoria: CategoriaIncidencia.RECLAMO,
  peso_corrupcion: 0,
  posible_corrupcion: false,
  alternativas: [],
  senales: [],
  actor: { cargo: null, nombre_mencionado: null },
  informacion_faltante: [],
  explicacion: "Texto de prueba.",
  ...parcial,
});

const clienteQue = (resultado: ResultadoConsulta): ClienteModelo => ({
  consultar: vi.fn(async () => resultado),
});
const clienteCon = (parcial: Partial<SalidaModelo>): ClienteModelo =>
  clienteQue({ ok: true, salida: salida(parcial), metricas: METRICAS });
const clienteCaido: ClienteModelo = clienteQue({
  ok: false,
  motivo: MotivoFalloIa.SIN_CONEXION,
  metricas: METRICAS,
});

const TEXTO_COBRO = "El director del hospital me pidió plata para atenderme";
const TEXTO_NEUTRO =
  "Quiero saber a qué hora abre la farmacia del hospital por las tardes";
const TEXTO_ZONA_GRIS =
  "El director del Hospital Dos de Mayo pide cosas a los pacientes que pagaron en caja";
const TEXTO_ACOSO_CARGO =
  "El director me acoso y me hizo propuestas indecentes en su oficina";
const TEXTO_ACOSO_PERSONAL =
  "Una enfermera me acoso y me hizo propuestas indecentes en el turno de noche";

describe("esquema de salida", () => {
  it("valida una salida correcta y expone el JSON Schema para Ollama", () => {
    expect(validarSalidaModelo(salida()).ok).toBe(true);
    const esquema = esquemaSalidaJson();
    expect(esquema).not.toHaveProperty("$schema");
    expect(Object.keys(esquema.properties as object)).toEqual([
      "categoria",
      "peso_corrupcion",
      "posible_corrupcion",
      "alternativas",
      "senales",
      "actor",
      "informacion_faltante",
      "explicacion",
    ]);
  });

  it("recorta el peso fuera de rango y acota probabilidades, pero rechaza una categoría inventada", () => {
    const recortado = validarSalidaModelo({
      ...salida(),
      peso_corrupcion: 99,
      alternativas: [{ categoria: "QUEJA", probabilidad: 3 }],
    });
    expect(recortado.ok && recortado.salida.peso_corrupcion).toBe(10);
    expect(recortado.ok && recortado.salida.alternativas[0]?.probabilidad).toBe(
      1,
    );
    expect(
      validarSalidaModelo({ ...salida(), categoria: "OTRA_COSA" }).ok,
    ).toBe(false);
    expect(validarSalidaModelo("texto").ok).toBe(false);
  });
});

describe("prompts", () => {
  it("el sistema es idéntico entre llamadas de la misma variante y V1 no lleva pistas", () => {
    const reglas = evaluarTextoCorrupcion(TEXTO_COBRO);
    const a = construirPeticion(VarianteIa.V2, TEXTO_COBRO, reglas);
    const b = construirPeticion(
      VarianteIa.V2,
      TEXTO_NEUTRO,
      evaluarTextoCorrupcion(TEXTO_NEUTRO),
      { establecimiento: "X" },
    );
    expect(a.sistema).toBe(b.sistema);
    expect(
      construirPeticion(VarianteIa.V1, TEXTO_COBRO, reglas).usuario,
    ).not.toContain("Pistas de las reglas");
    expect(a.usuario).toContain("Pistas de las reglas");
  });

  it("V3 agrega ejemplos resueltos y las tres variantes son distintas", () => {
    expect(PROMPT_SISTEMA.V3).toContain("EJEMPLOS RESUELTOS");
    expect(PROMPT_SISTEMA.V2).not.toContain("EJEMPLOS RESUELTOS");
    expect(new Set(Object.values(PROMPT_SISTEMA)).size).toBe(3);
  });
});

describe("cliente de Ollama", () => {
  const respuestaOk = (cuerpo: unknown): Response =>
    new Response(JSON.stringify(cuerpo), { status: 200 });
  const conMensaje = (contenido: string): Response =>
    respuestaOk({
      message: { content: contenido },
      total_duration: 4_000_000_000,
      eval_count: 7,
      prompt_eval_count: 30,
    });
  const peticion = { sistema: "s", usuario: "u" };

  it("devuelve la salida válida con sus métricas en milisegundos", async () => {
    const fetchFn = vi.fn(async () =>
      conMensaje(JSON.stringify(salida({ peso_corrupcion: 4 }))),
    );
    const r = await crearClienteOllama({ fetchFn }).consultar(peticion);
    expect(r.ok && r.salida.peso_corrupcion).toBe(4);
    expect(r.metricas).toMatchObject({
      intentos: 1,
      totalOllamaMs: 4000,
      tokensSalida: 7,
      tokensPrompt: 30,
    });
    const cuerpo = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      stream: false,
      think: false,
      model: "qwen3.5-9b-local",
      options: { temperature: 0, seed: 7 },
    });
    expect(cuerpo.format).toEqual(esquemaSalidaJson());
  });

  it("reintenta una vez con el mismo prompt si el JSON no valida y se recupera", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(conMensaje("{no es json"))
      .mockResolvedValueOnce(conMensaje(JSON.stringify(salida())));
    const r = await crearClienteOllama({ fetchFn }).consultar(peticion);
    expect(r.ok).toBe(true);
    expect(r.metricas.intentos).toBe(2);
    const cuerpoDe = (i: number): string =>
      (fetchFn.mock.calls[i] as unknown as [string, { body: string }])[1].body;
    expect(cuerpoDe(0)).toBe(cuerpoDe(1));
  });

  it("tras el reintento fallido devuelve el motivo en vez de lanzar", async () => {
    const fetchFn = vi.fn(async () => conMensaje("{}"));
    const r = await crearClienteOllama({ fetchFn }).consultar(peticion);
    expect(r).toMatchObject({
      ok: false,
      motivo: MotivoFalloIa.ESQUEMA_INVALIDO,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("un error de red se reintenta y no lanza; un tiempo agotado no se reintenta", async () => {
    const red = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(
      await crearClienteOllama({ fetchFn: red }).consultar(peticion),
    ).toMatchObject({ ok: false, motivo: MotivoFalloIa.SIN_CONEXION });
    expect(red).toHaveBeenCalledTimes(2);
    const tarde = vi.fn(async () => {
      throw new DOMException("agotado", "TimeoutError");
    });
    expect(
      await crearClienteOllama({ fetchFn: tarde }).consultar(peticion),
    ).toMatchObject({ ok: false, motivo: MotivoFalloIa.TIEMPO_AGOTADO });
    expect(tarde).toHaveBeenCalledTimes(1);
  });

  it("un HTTP 4xx no se reintenta y un cuerpo vacío es respuesta vacía", async () => {
    const rechazo = vi.fn(async () => new Response("no", { status: 404 }));
    expect(
      await crearClienteOllama({ fetchFn: rechazo }).consultar(peticion),
    ).toMatchObject({ ok: false, motivo: MotivoFalloIa.ERROR_HTTP });
    expect(rechazo).toHaveBeenCalledTimes(1);
    const vacio = vi.fn(async () => conMensaje("  "));
    expect(
      await crearClienteOllama({ fetchFn: vacio }).consultar(peticion),
    ).toMatchObject({ ok: false, motivo: MotivoFalloIa.RESPUESTA_VACIA });
  });
});

describe("analizarMensaje", () => {
  it("salida válida: el peso del modelo se suma y sube un caso que las reglas no proponían", async () => {
    const p = await analizarMensaje(
      TEXTO_ZONA_GRIS,
      {},
      {
        cliente: clienteCon({
          categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
          peso_corrupcion: 7,
          posible_corrupcion: true,
        }),
      },
    );
    expect(p.reglas.propuestaCorrupcion).toBe(false);
    expect(p).toMatchObject({
      propuesta: "DENUNCIA_CORRUPCION",
      pesoIa: 7,
      degradado: false,
      requiereOtrans: true,
    });
    expect(p.combinacion.subidaPorIa).toBe(true);
  });

  it("caída del modelo: degrada a solo reglas, sin lanzar", async () => {
    const p = await analizarMensaje(TEXTO_COBRO, {}, { cliente: clienteCaido });
    expect(p).toMatchObject({
      degradado: true,
      motivoDegradado: MotivoFalloIa.SIN_CONEXION,
      pesoIa: null,
      propuesta: "DENUNCIA_CORRUPCION",
    });
  });

  it("degradado con zona gris: revisión de OTRANS por defecto", async () => {
    const p = await analizarMensaje(
      TEXTO_ZONA_GRIS,
      {},
      { cliente: clienteCaido },
    );
    expect(p.degradado).toBe(true);
    expect(p.reglas.requiereSegundaOpinion).toBe(true);
    expect(p.revisionOtrans).toBe(true);
  });

  it("peso fuera de rango: el esquema lo recorta a 10 y la combinación nunca pasa de 10", async () => {
    const cliente = crearClienteOllama({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({ ...salida(), peso_corrupcion: 40 }),
            },
          }),
        ),
    });
    const p = await analizarMensaje(TEXTO_ZONA_GRIS, {}, { cliente });
    expect(p.pesoIa).toBe(10);
  });

  it("empate entre queja y reclamo: propone Reclamo con revisión humana", async () => {
    const empate = {
      categoria: CategoriaIncidencia.QUEJA,
      alternativas: [
        { categoria: CategoriaIncidencia.QUEJA, probabilidad: 0.5 },
        { categoria: CategoriaIncidencia.RECLAMO, probabilidad: 0.45 },
      ],
    };
    expect(hayEmpateQuejaReclamo(salida(empate))).toBe(true);
    const p = await analizarMensaje(
      TEXTO_NEUTRO,
      {},
      { cliente: clienteCon(empate) },
    );
    expect(p).toMatchObject({
      propuesta: "RECLAMO",
      empateQuejaReclamo: true,
      requiereRevisionHumana: true,
    });
    const claro = await analizarMensaje(
      TEXTO_NEUTRO,
      {},
      {
        cliente: clienteCon({
          categoria: CategoriaIncidencia.QUEJA,
          alternativas: [
            { categoria: CategoriaIncidencia.RECLAMO, probabilidad: 0.1 },
          ],
        }),
      },
    );
    expect(claro).toMatchObject({
      propuesta: "QUEJA",
      empateQuejaReclamo: false,
    });
  });

  it("acoso: propone Reclamo y solo escala a OTRANS con un cargo mayor", async () => {
    const cliente = clienteCon({ categoria: CategoriaIncidencia.QUEJA });
    const mayor = await analizarMensaje(TEXTO_ACOSO_CARGO, {}, { cliente });
    expect(mayor).toMatchObject({
      propuesta: "RECLAMO",
      escalarAOtrans: true,
      senalSensible: "ACOSO",
    });
    const personal = await analizarMensaje(
      TEXTO_ACOSO_PERSONAL,
      {},
      { cliente },
    );
    expect(personal).toMatchObject({
      propuesta: "RECLAMO",
      escalarAOtrans: false,
      senalSensible: "ACOSO",
    });
  });

  it("el modelo nunca baja un caso que las reglas marcaron, con peso 0 o categoría OTRO", async () => {
    const p = await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        cliente: clienteCon({
          categoria: CategoriaIncidencia.OTRO,
          peso_corrupcion: 0,
        }),
      },
    );
    expect(p.reglas.propuestaCorrupcion).toBe(true);
    expect(p).toMatchObject({
      propuesta: "DENUNCIA_CORRUPCION",
      requiereOtrans: true,
    });
  });

  it("si el modelo ve corrupción pero la suma no alcanza, ante la duda va a OTRANS con revisión humana", async () => {
    const p = await analizarMensaje(
      TEXTO_NEUTRO,
      {},
      {
        cliente: clienteCon({
          categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
          peso_corrupcion: 2,
          posible_corrupcion: true,
        }),
        pisoPesoPosibleCorrupcion: null,
      },
    );
    expect(p.combinacion.propuestaCorrupcion).toBe(false);
    expect(p).toMatchObject({
      propuesta: "RECLAMO",
      revisionOtrans: true,
      requiereRevisionHumana: true,
    });
  });

  it("el piso de peso por posible_corrupcion sube la sospecha cuando se configura", async () => {
    const cliente = clienteCon({
      categoria: CategoriaIncidencia.RECLAMO,
      peso_corrupcion: 1,
      posible_corrupcion: true,
    });
    expect(
      (
        await analizarMensaje(
          TEXTO_ZONA_GRIS,
          {},
          { cliente, pisoPesoPosibleCorrupcion: null },
        )
      ).combinacion.subidaPorIa,
    ).toBe(false);
    // Por defecto rige el piso calibrado en desarrollo-v2 (6).
    expect(
      (await analizarMensaje(TEXTO_ZONA_GRIS, {}, { cliente })).combinacion
        .pesoIa,
    ).toBe(6);
    expect(
      (
        await analizarMensaje(
          TEXTO_ZONA_GRIS,
          {},
          { cliente, pisoPesoPosibleCorrupcion: 6 },
        )
      ).combinacion.subidaPorIa,
    ).toBe(true);
  });

  it("texto corto: no consulta al modelo y propone OTRO sin degradar", async () => {
    const cliente = clienteCon({});
    const p = await analizarMensaje("hola", {}, { cliente });
    expect(cliente.consultar).not.toHaveBeenCalled();
    expect(p).toMatchObject({
      propuesta: "OTRO",
      degradado: false,
      pesoIa: null,
      variante: null,
    });
  });

  it("la confianza nunca llega a 100, ni con acuerdo total", async () => {
    const p = await analizarMensaje(
      "El jefe del SIS, Zulma Anaya Chacón, me pidió plata para atenderme",
      {},
      {
        cliente: clienteCon({
          categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
          peso_corrupcion: 10,
          posible_corrupcion: true,
        }),
      },
    );
    expect(p.confianza).toBeLessThanOrEqual(95);
    expect(p.confianza).toBeLessThan(100);
  });

  it("la ficha de derivación viene de las reglas con el destino si es contra el titular", async () => {
    const p = await analizarMensaje(
      "La jefa del SIS, Zulma Anaya Chacón, me pidió plata para atenderme",
      {},
      { cliente: clienteCaido },
    );
    expect(p.fichaDerivacion).toMatchObject({
      codigoEntidad: "sis",
      aplicaAlTitular: true,
    });
    expect(p.fichaDerivacion?.destinoSiTitular).not.toBeNull();
  });
});

describe("privacidad", () => {
  const espiar = () => ({
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    info: vi.spyOn(console, "info").mockImplementation(() => undefined),
    escritura: vi.spyOn(process.stdout, "write").mockImplementation(() => true),
  });

  afterEach(() => vi.restoreAllMocks());

  it("ningún texto se registra en logs, ni con el modelo caído ni con una salida inválida", async () => {
    const espias = espiar();
    await analizarMensaje(
      TEXTO_COBRO,
      { establecimiento: "Centro Secreto" },
      { cliente: clienteCaido },
    );
    await analizarMensaje(
      TEXTO_COBRO,
      {},
      {
        cliente: crearClienteOllama({
          fetchFn: async () => new Response("{}"),
          reintentos: 0,
        }),
      },
    );
    await analizarMensaje(
      TEXTO_COBRO,
      {},
      { cliente: clienteCon({ explicacion: "ok" }) },
    );
    for (const espia of Object.values(espias))
      expect(espia).not.toHaveBeenCalled();
  });

  it("el motivo del fallo no contiene el texto", async () => {
    const p = await analizarMensaje(TEXTO_COBRO, {}, { cliente: clienteCaido });
    expect(JSON.stringify([p.motivoDegradado, p.metricas])).not.toContain(
      "plata",
    );
  });
});
