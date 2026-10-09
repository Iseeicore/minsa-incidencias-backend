import { describe, expect, it } from "vitest";
import { TOPE_CONFIANZA_CON_DUDA } from "@/constants/clasificador.js";
import { MotivoFalloIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { MotivoDeEscritura } from "@/enums/clasificador.enum.js";
import { OrigenPropuesta } from "@/enums/filtro-corrupcion.enum.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type {
  ClienteModelo,
  MetricasModelo,
  PaqueteAnalisis,
} from "@/services/analisis-ia/analisis-ia.types.js";
import type { SalidaCompacta } from "@/services/analisis-ia/esquema-salida.js";
import {
  construirVersionClasificador,
  decidirEscritura,
} from "@/services/clasificador/regla-de-escritura.js";

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

const modelo = (parcial: Partial<SalidaCompacta> = {}): ClienteModelo => ({
  consultar: async () => ({
    ok: true,
    salida: {
      categoria: CategoriaIncidencia.RECLAMO,
      peso_corrupcion: 0,
      posible_corrupcion: false,
      ...parcial,
    },
    metricas: METRICAS,
  }),
});
const modeloCaido: ClienteModelo = {
  consultar: async () => ({
    ok: false,
    motivo: MotivoFalloIa.SIN_CONEXION,
    metricas: METRICAS,
  }),
};

const TEXTO_COBRO = "El director del hospital me pidió plata para atenderme";
const TEXTO_NEUTRO =
  "Quiero saber a qué hora abre la farmacia del hospital por las tardes";
const TEXTO_ZONA_GRIS =
  "El director del Hospital Dos de Mayo pide cosas a los pacientes que pagaron en caja";
const TEXTO_ACOSO_CARGO =
  "El director me acoso y me hizo propuestas indecentes en su oficina";

const analizar = (
  texto: string,
  cliente: ClienteModelo,
  piso?: number | null,
): Promise<PaqueteAnalisis> =>
  analizarMensaje(
    texto,
    {},
    {
      variante: VarianteIa.V2C,
      cliente,
      ...(piso !== undefined ? { pisoPesoPosibleCorrupcion: piso } : {}),
    },
  );

describe("regla de escritura (B2)", () => {
  it("corrupción propuesta por las reglas: DENUNCIA_CORRUPCION con la confianza del análisis, aunque el modelo diga otra cosa", async () => {
    const paquete = await analizar(
      TEXTO_COBRO,
      modelo({ categoria: CategoriaIncidencia.OTRO }),
    );
    const decision = decidirEscritura(paquete);
    expect(decision).toMatchObject({
      categoria: "DENUNCIA_CORRUPCION",
      motivo: MotivoDeEscritura.REGLAS,
    });
    expect(decision.confianza).toBe(paquete.confianza);
    expect(decision.confianza).toBeLessThanOrEqual(95);
  });

  it("corrupción por identidad: lo anota como IDENTIDAD", async () => {
    const paquete = await analizar(TEXTO_COBRO, modelo());
    const porIdentidad: PaqueteAnalisis = {
      ...paquete,
      reglas: { ...paquete.reglas, origenPropuesta: OrigenPropuesta.IDENTIDAD },
    };
    expect(decidirEscritura(porIdentidad).motivo).toBe(
      MotivoDeEscritura.IDENTIDAD,
    );
  });

  it("el peso del modelo lleva el total sobre el umbral: DENUNCIA_CORRUPCION por SUMA_CON_MODELO", async () => {
    const paquete = await analizar(
      TEXTO_ZONA_GRIS,
      modelo({
        categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
        peso_corrupcion: 7,
        posible_corrupcion: true,
      }),
    );
    expect(paquete.reglas.propuestaCorrupcion).toBe(false);
    expect(decidirEscritura(paquete)).toMatchObject({
      categoria: "DENUNCIA_CORRUPCION",
      motivo: MotivoDeEscritura.SUMA_CON_MODELO,
    });
  });

  it("duda del modelo (sospecha corrupción y la suma no alcanza): DENUNCIA_CORRUPCION con confianza de a lo más 55, aunque el análisis proponga Reclamo", async () => {
    const paquete = await analizar(
      TEXTO_NEUTRO,
      modelo({
        categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
        peso_corrupcion: 2,
        posible_corrupcion: true,
      }),
      null,
    );
    expect(paquete.propuesta).toBe("RECLAMO");
    expect(paquete.revisionOtrans).toBe(true);
    const decision = decidirEscritura(paquete);
    expect(decision).toMatchObject({
      categoria: "DENUNCIA_CORRUPCION",
      motivo: MotivoDeEscritura.DUDA_DEL_MODELO,
      propuestaDelAnalisis: "RECLAMO",
    });
    expect(decision.confianza).toBeLessThanOrEqual(TOPE_CONFIANZA_CON_DUDA);
  });

  it("zona gris con el modelo caído: ante la duda, OTRANS, con confianza de a lo más 55", async () => {
    const paquete = await analizar(TEXTO_ZONA_GRIS, modeloCaido);
    expect(paquete.degradado).toBe(true);
    const decision = decidirEscritura(paquete);
    expect(decision).toMatchObject({
      categoria: "DENUNCIA_CORRUPCION",
      motivo: MotivoDeEscritura.DUDA_SIN_MODELO,
    });
    expect(decision.confianza).toBeLessThanOrEqual(TOPE_CONFIANZA_CON_DUDA);
  });

  it("sin corrupción ni duda se escribe la categoría del análisis", async () => {
    for (const categoria of [
      CategoriaIncidencia.QUEJA,
      CategoriaIncidencia.RECLAMO,
      CategoriaIncidencia.OTRO,
    ]) {
      const paquete = await analizar(TEXTO_NEUTRO, modelo({ categoria }));
      expect(decidirEscritura(paquete)).toMatchObject({
        categoria,
        motivo: MotivoDeEscritura.SIN_CORRUPCION,
        confianza: paquete.confianza,
      });
    }
  });

  it("acoso contra un cargo mayor: solo se marca (escalarAOtrans); la categoría sigue siendo Reclamo", async () => {
    const paquete = await analizar(
      TEXTO_ACOSO_CARGO,
      modelo({ categoria: CategoriaIncidencia.QUEJA }),
    );
    const decision = decidirEscritura(paquete);
    expect(decision).toMatchObject({
      categoria: "RECLAMO",
      escalarAOtrans: true,
      motivo: MotivoDeEscritura.SIN_CORRUPCION,
    });
  });

  it("invariante: con corrupción o duda de corrupción nunca se escribe una categoría que la base mande a un establecimiento", async () => {
    const textos = [
      TEXTO_COBRO,
      TEXTO_NEUTRO,
      TEXTO_ZONA_GRIS,
      TEXTO_ACOSO_CARGO,
      "La jefa del SIS, Zulma Anaya Chacón, me pidió plata para atenderme",
      "Me cobraron sin recibo en el hospital y la atención fue lenta",
      "Mi cita fue reprogramada tres veces y nadie me avisó nada",
    ];
    const salidas: Partial<SalidaCompacta>[] = [
      {},
      { categoria: CategoriaIncidencia.QUEJA },
      { categoria: CategoriaIncidencia.OTRO },
      {
        categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
        peso_corrupcion: 1,
        posible_corrupcion: true,
      },
      {
        categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
        peso_corrupcion: 9,
        posible_corrupcion: true,
      },
      { posible_corrupcion: true, peso_corrupcion: 3 },
    ];
    for (const texto of textos)
      for (const salida of salidas)
        for (const cliente of [modelo(salida), modeloCaido]) {
          for (const piso of [null, 6]) {
            const paquete = await analizar(texto, cliente, piso);
            const decision = decidirEscritura(paquete);
            if (paquete.requiereOtrans || paquete.revisionOtrans)
              expect(decision.categoria).toBe(
                CategoriaIncidencia.DENUNCIA_CORRUPCION,
              );
            expect(decision.confianza).toBeLessThan(100);
            expect(decision.confianza).toBeLessThanOrEqual(95);
            expect(decision.confianza).toBeGreaterThanOrEqual(0);
            if (!paquete.requiereOtrans && paquete.revisionOtrans)
              expect(decision.confianza).toBeLessThanOrEqual(
                TOPE_CONFIANZA_CON_DUDA,
              );
          }
        }
  });

  it("la confianza se guarda con dos decimales y se acota entre 0 y 95", async () => {
    const paquete = await analizar(TEXTO_COBRO, modelo());
    for (const confianza of [99.999, 100, 120, -4, 61.23456]) {
      const d = decidirEscritura({ ...paquete, confianza });
      expect(d.confianza).toBeGreaterThanOrEqual(0);
      expect(d.confianza).toBeLessThanOrEqual(95);
      expect(Math.round(d.confianza * 100) / 100).toBe(d.confianza);
    }
  });
});

describe("version del clasificador", () => {
  it("con modelo: reglas, modelo y variante", async () => {
    const paquete = await analizar(TEXTO_COBRO, modelo());
    expect(construirVersionClasificador(paquete, "qwen3.5-9b-local")).toBe(
      `${paquete.reglas.versionReglas}+qwen3.5-9b-local+V2C`,
    );
  });

  it("con el modelo caído o sin consultarlo dice solo-reglas", async () => {
    const caido = await analizar(TEXTO_COBRO, modeloCaido);
    expect(construirVersionClasificador(caido, "qwen3.5-9b-local")).toBe(
      `${caido.reglas.versionReglas}+solo-reglas`,
    );
    const corto = await analizar("hola", modelo());
    expect(construirVersionClasificador(corto, "qwen3.5-9b-local")).toBe(
      `${corto.reglas.versionReglas}+solo-reglas`,
    );
  });
});
