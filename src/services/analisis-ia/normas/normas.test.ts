import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ETIQUETA_REFERENCIA_ORIENTATIVA,
  MAXIMO_SUPUESTOS_CITADOS,
} from "@/constants/normas.js";
import { MotivoFalloIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import {
  FuenteNorma,
  GrupoCita,
  TipoFragmentoNorma,
} from "@/enums/normas.enum.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type {
  ClienteModelo,
  MetricasModelo,
} from "@/services/analisis-ia/analisis-ia.types.js";
import { construirTrazabilidadNormas } from "@/services/analisis-ia/normas/citar-normas.js";
import { DATOS_NORMAS } from "@/services/analisis-ia/normas/fragmentos-normas.data.js";
import { MAPA_SENAL_FRAGMENTO } from "@/services/analisis-ia/normas/mapa-senal-fragmento.js";
import { construirSenalesDeAnalisis } from "@/services/analisis-ia/senales-analisis.js";
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
const clienteCon = (
  categoria: CategoriaIncidencia,
  peso: number,
  posible: boolean,
): ClienteModelo => ({
  consultar: async () => ({
    ok: true,
    salida: { categoria, peso_corrupcion: peso, posible_corrupcion: posible },
    metricas: METRICAS,
  }),
});
const clienteCaido: ClienteModelo = {
  consultar: async () => ({
    ok: false,
    motivo: MotivoFalloIa.SIN_CONEXION,
    metricas: METRICAS,
  }),
};

const trazar = (
  texto: string,
  corrupcion = true,
  propuesta: CategoriaIncidencia = CategoriaIncidencia.DENUNCIA_CORRUPCION,
) =>
  construirTrazabilidadNormas({
    reglas: evaluarTextoCorrupcion(texto),
    propuesta,
    propuestaCorrupcion: corrupcion,
  });
const idsDe = (t: ReturnType<typeof trazar>): string[] =>
  t.supuestos.map((c) => c.fragmentoId);

describe("datos de las normas", () => {
  it("el .data.ts generado coincide con el JSON versionado (corre node ia-poc/scripts/generar-normas.mjs si falla)", () => {
    const json = JSON.parse(
      readFileSync(
        new URL(
          "../../../../ia-poc/datos/fragmentos-normas.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;
    expect(DATOS_NORMAS).toEqual(json);
  });

  it("trae los 20 supuestos del Anexo C (5 faltas, 6 inconductas, 9 delitos) y marca la transcripción como no cotejada", () => {
    const anexo = DATOS_NORMAS.fragmentos.filter(
      (f) => f.fuente === FuenteNorma.DIRECTIVA_002_2023_PCM_SIP,
    );
    const cuenta = (tipo: TipoFragmentoNorma) =>
      anexo.filter((f) => f.tipo === tipo).length;
    expect(anexo).toHaveLength(20);
    expect(cuenta(TipoFragmentoNorma.FALTA)).toBe(5);
    expect(cuenta(TipoFragmentoNorma.INCONDUCTA)).toBe(6);
    expect(cuenta(TipoFragmentoNorma.DELITO)).toBe(9);
    expect(DATOS_NORMAS.transcripcionAnexoCCotejada).toBe(false);
    expect(DATOS_NORMAS.avisoTranscripcion).toContain("sin OCR");
  });

  it("los ids no se repiten, todo fragmento tiene texto y el cohecho activo no se cita solo", () => {
    const ids = DATOS_NORMAS.fragmentos.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of DATOS_NORMAS.fragmentos)
      expect(f.texto.trim()).not.toBe("");
    const activo = DATOS_NORMAS.fragmentos.find(
      (f) => f.id === "ANEXO_C-III-a",
    );
    expect(activo).toMatchObject({ citaAutomatica: false });
    expect(activo?.motivoSinCita).toBeTruthy();
    expect(activo?.texto).toContain("Cohecho activo");
  });

  it("todo fragmento que nombra el mapa existe y el mapa nunca apunta al cohecho activo", () => {
    const ids = new Set(DATOS_NORMAS.fragmentos.map((f) => f.id));
    for (const tema of MAPA_SENAL_FRAGMENTO)
      for (const id of tema.fragmentos) {
        expect(ids.has(id)).toBe(true);
        expect(id).not.toBe("ANEXO_C-III-a");
      }
  });
});

describe("mapa señal → supuesto", () => {
  it("cobro o coima cita el cohecho pasivo, con la señal que lo motiva", () => {
    const t = trazar("El director del hospital me pidió plata para atenderme");
    expect(idsDe(t)).toContain("ANEXO_C-III-b");
    const cita = t.supuestos.find((c) => c.fragmentoId === "ANEXO_C-III-b");
    expect(cita?.senalesQueLaMotivan.length).toBeGreaterThan(0);
    expect(cita?.texto).toContain(
      "Cohecho pasivo: El servidor público que recibe",
    );
    expect(cita?.motivo).toContain("«");
    expect(t.etiqueta).toBe(ETIQUETA_REFERENCIA_ORIENTATIVA);
  });

  it("exigir cita la concusión, además del cohecho pasivo", () => {
    const t = trazar(
      "El jefe de logística me exigió plata para firmar la entrega",
    );
    expect(idsDe(t)).toEqual(
      expect.arrayContaining(["ANEXO_C-III-b", "ANEXO_C-III-d"]),
    );
  });

  it("licitación dirigida cita actuación parcializada y colusión", () => {
    const t = trazar(
      "Hubo una licitacion dirigida en el hospital y compras sobrevaloradas",
    );
    expect(idsDe(t)).toEqual(
      expect.arrayContaining(["ANEXO_C-II-d", "ANEXO_C-III-c"]),
    );
  });

  it("vender medicinas del Estado cita el peculado", () => {
    const t = trazar("La enfermera vende las medicinas del SIS");
    expect(idsDe(t)).toContain("ANEXO_C-III-h");
  });

  it("contratar a un hermano cita el nepotismo", () => {
    const t = trazar("El director contrató a su hermano en el hospital");
    expect(idsDe(t)).toContain("ANEXO_C-I-d");
  });

  it("las plantillas del mapa se pueden compilar y tienen al menos una frase", () => {
    for (const tema of MAPA_SENAL_FRAGMENTO) {
      expect(tema.plantillas.length).toBeGreaterThan(0);
      expect(tema.fragmentos.length).toBeGreaterThan(0);
    }
  });

  it("nunca cita más supuestos que el tope, aunque haya muchas señales", () => {
    const t = trazar(
      "El director me pidió coima, contrató a su hermano, hubo licitacion dirigida, venden las medicinas, se hizo rico sin que nadie sepa y filtraron informacion reservada",
    );
    expect(t.supuestos.length).toBeLessThanOrEqual(MAXIMO_SUPUESTOS_CITADOS);
    expect(t.supuestos.length).toBe(MAXIMO_SUPUESTOS_CITADOS);
  });

  it("es determinista: la misma entrada da la misma salida", () => {
    const texto = "El director me pidió plata para atenderme";
    expect(trazar(texto)).toEqual(trazar(texto));
  });
});

describe("cohecho activo no se cita contra quien paga", () => {
  it("un ciudadano que cuenta que pagó una coima no recibe el supuesto III-a, ni como supuesto ni como procedimiento", () => {
    for (const texto of [
      "Le pague una coima al medico para que me atendiera",
      "Ofreci un soborno al vigilante para pasar primero",
      "Le di plata al doctor por debajo de la mesa y me siento mal",
    ]) {
      const t = trazar(texto);
      const todas = [...t.supuestos, ...t.procedimiento].map(
        (c) => c.fragmentoId,
      );
      expect(todas).not.toContain("ANEXO_C-III-a");
      expect(JSON.stringify(t)).not.toContain("Cohecho activo");
    }
  });
});

describe("sin supuesto identificado", () => {
  it("si se propone corrupción y ninguna señal coincide, lo dice en vez de inventar un supuesto", () => {
    const t = trazar("El director del Hospital Dos de Mayo recibe cosas raras");
    expect(t.supuestos).toEqual([]);
    expect(t.sinSupuestoIdentificado).toBe(true);
    expect(t.procedimiento.map((c) => c.fragmentoId)).toContain(
      "AM-DENUNCIA-CORRUPCION",
    );
  });

  it("si no se propone corrupción no cita ningún supuesto del Anexo C ni marca la falta de supuesto", () => {
    const t = trazar(
      "Me cobraron sin recibo en el hospital y la atencion fue lenta",
      false,
      CategoriaIncidencia.RECLAMO,
    );
    expect(t.supuestos).toEqual([]);
    expect(t.sinSupuestoIdentificado).toBe(false);
  });
});

describe("procedimiento de OTRANS", () => {
  it("corrupción: cita la definición, los criterios, la derivación y los requisitos que faltan", () => {
    const reglas = evaluarTextoCorrupcion("Me pidieron plata para atenderme");
    const t = construirTrazabilidadNormas({
      reglas,
      propuesta: CategoriaIncidencia.DENUNCIA_CORRUPCION,
      propuestaCorrupcion: true,
    });
    const ids = t.procedimiento.map((c) => c.fragmentoId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "AM-DENUNCIA-CORRUPCION",
        "AM-CRITERIOS-DENUNCIA",
        "AM-DERIVA-STPAD-OCI-PP",
      ]),
    );
    const requisitos: Record<string, string> = {
      DATOS_INSUFICIENTES: "AM-REQ-HECHO-DETALLADO",
      AUTOR_O_CARGO: "AM-REQ-AUTORES",
      ENTIDAD: "AM-REQ-ENTIDAD",
      PRUEBAS: "AM-REQ-PRUEBAS",
    };
    for (const faltante of reglas.faltantes)
      expect(ids).toContain(requisitos[faltante]);
    expect(reglas.faltantes.length).toBeGreaterThan(0);
    expect(
      t.procedimiento.every((c) => c.grupo === GrupoCita.PROCEDIMIENTO),
    ).toBe(true);
  });

  it("queja: cita que OTRANS deriva quejas y reclamos; reclamo agrega la definición de SUSALUD", () => {
    const reglas = evaluarTextoCorrupcion(
      "El personal me trato mal en la ventanilla",
    );
    const queja = construirTrazabilidadNormas({
      reglas,
      propuesta: CategoriaIncidencia.QUEJA,
      propuestaCorrupcion: false,
    });
    expect(queja.procedimiento.map((c) => c.fragmentoId)).toEqual([
      "AM-DERIVA-QUEJAS-RECLAMOS",
    ]);
    const reclamo = construirTrazabilidadNormas({
      reglas,
      propuesta: CategoriaIncidencia.RECLAMO,
      propuestaCorrupcion: false,
    });
    expect(reclamo.procedimiento.map((c) => c.fragmentoId)).toEqual([
      "AM-DERIVA-QUEJAS-RECLAMOS",
      "AM-DEF-RECLAMO",
    ]);
    const otro = construirTrazabilidadNormas({
      reglas,
      propuesta: CategoriaIncidencia.OTRO,
      propuestaCorrupcion: false,
    });
    expect(otro.procedimiento).toEqual([]);
  });
});

describe("en el paquete del análisis", () => {
  const TEXTO = "El director del hospital me pidió plata para atenderme";

  it("todas las variantes traen la trazabilidad, también si el modelo cae, y V2C no cambia lo que escribe el modelo", async () => {
    for (const variante of [
      VarianteIa.V1,
      VarianteIa.V2,
      VarianteIa.V3,
      VarianteIa.V2C,
    ]) {
      const p = await analizarMensaje(
        TEXTO,
        {},
        { variante, cliente: clienteCaido },
      );
      expect(p.degradado).toBe(true);
      expect(
        p.trazabilidadNormas.supuestos.map((c) => c.fragmentoId),
      ).toContain("ANEXO_C-III-b");
      expect(p.trazabilidadNormas.etiqueta).toBe(
        ETIQUETA_REFERENCIA_ORIENTATIVA,
      );
      expect(p.trazabilidadNormas.transcripcionAnexoCCotejada).toBe(false);
    }
  });

  it("la cita no cambia la propuesta, la confianza ni el peso (solo se agrega)", async () => {
    const cliente = clienteCon(
      CategoriaIncidencia.DENUNCIA_CORRUPCION,
      8,
      true,
    );
    const p = await analizarMensaje(
      TEXTO,
      {},
      { variante: VarianteIa.V2C, cliente },
    );
    expect(p).toMatchObject({
      propuesta: "DENUNCIA_CORRUPCION",
      pesoIa: 8,
      requiereOtrans: true,
    });
    expect(p.confianza).toBeLessThanOrEqual(95);
  });

  it("queja propuesta por el modelo: cita la derivación de quejas y reclamos", async () => {
    const p = await analizarMensaje(
      "Quiero saber a qué hora abre la farmacia del hospital por las tardes",
      {},
      { cliente: clienteCon(CategoriaIncidencia.QUEJA, 0, false) },
    );
    expect(p.propuesta).toBe("QUEJA");
    expect(p.trazabilidadNormas.supuestos).toEqual([]);
    expect(
      p.trazabilidadNormas.procedimiento.map((c) => c.fragmentoId),
    ).toContain("AM-DERIVA-QUEJAS-RECLAMOS");
  });

  it("construirSenalesDeAnalisis arma el jsonb con ids y referencias, sin el texto de las normas ni el del ciudadano", async () => {
    const p = await analizarMensaje(
      TEXTO,
      {},
      { variante: VarianteIa.V2C, cliente: clienteCaido },
    );
    const senales = construirSenalesDeAnalisis(p);
    expect(senales.normas.version).toBe("normas-v1");
    expect(senales.normas.etiqueta).toBe(ETIQUETA_REFERENCIA_ORIENTATIVA);
    expect(senales.normas.citas.map((c) => c.fragmentoId)).toContain(
      "ANEXO_C-III-b",
    );
    expect(senales.senales).toEqual(p.reglas.senales);
    expect(senales.faltantes).toEqual(p.informacionFaltante);
    const serializado = JSON.stringify(senales);
    expect(serializado).not.toContain("El servidor público que recibe");
    expect(serializado).not.toContain(TEXTO);
  });
});
