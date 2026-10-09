import { describe, expect, it } from "vitest";
import { ETIQUETA_REFERENCIA_ORIENTATIVA } from "@/constants/normas.js";
import { MotivoFalloIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type { MetricasModelo } from "@/services/analisis-ia/analisis-ia.types.js";
import { DATOS_NORMAS } from "@/services/analisis-ia/normas/fragmentos-normas.data.js";
import type { FilaAnalisis } from "@/repositories/analisis-incidencia.repository.js";
import { construirAnalisisDto } from "@/services/analisis-incidencia/construir-analisis-dto.js";
import { decidirEscritura } from "@/services/clasificador/regla-de-escritura.js";
import { construirSenalesGuardadas } from "@/services/clasificador/senales-guardadas.js";

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

const TEXTO =
  "La jefa del SIS, Zulma Anaya Chacón, me pidió plata para atenderme";

/** Lo que el clasificador guardaría y la base devolvería, armado con el mismo código de producción. */
async function filaGuardada(
  texto: string,
  modeloCaido = false,
): Promise<FilaAnalisis> {
  const paquete = await analizarMensaje(
    texto,
    {},
    {
      variante: VarianteIa.V2C,
      cliente: {
        consultar: async () =>
          modeloCaido
            ? {
                ok: false,
                motivo: MotivoFalloIa.SIN_CONEXION,
                metricas: METRICAS,
              }
            : {
                ok: true,
                salida: {
                  categoria: CategoriaIncidencia.DENUNCIA_CORRUPCION,
                  peso_corrupcion: 8,
                  posible_corrupcion: true,
                },
                metricas: METRICAS,
              },
      },
    },
  );
  const decision = decidirEscritura(paquete);
  return {
    versionReglas: paquete.reglas.versionReglas,
    puntaje: paquete.reglas.puntaje,
    // Pasa por JSON como pasaría por la base (jsonb).
    senales: JSON.parse(
      JSON.stringify(construirSenalesGuardadas(paquete, decision)),
    ),
    cargoMencionado: paquete.reglas.actor?.cargo ?? null,
    nombreMencionado: paquete.reglas.nombreMencionado,
    areaMencionadaCodigo: null,
    areaMencionadaNombre: null,
    categoriaIa: decision.categoria,
    confianzaIa: decision.confianza,
    versionClasificador: "reglas-corrupcion-v1.3+modelo+V2C",
    fechaAnalisis: new Date("2026-10-09T12:00:00.000Z"),
  };
}

describe("construirAnalisisDto", () => {
  it("devuelve la explicación, las señales, los supuestos con su texto literal y la etiqueta orientativa", async () => {
    const dto = construirAnalisisDto(
      "MINSA-2026-000001",
      await filaGuardada(TEXTO),
    );
    expect(dto).toMatchObject({
      codigo: "MINSA-2026-000001",
      categoriaIa: "denuncia-corrupcion",
      motivoDeEscritura: "REGLAS",
      propuestaDelAnalisis: "denuncia-corrupcion",
      etiquetaNormas: ETIQUETA_REFERENCIA_ORIENTATIVA,
      versionNormas: DATOS_NORMAS.version,
      transcripcionAnexoCCotejada: false,
      sinSupuestoIdentificado: false,
      requiereRevisionHumana: true,
      modelo: { variante: "V2C", degradado: false, pesoIa: 8 },
      fechaAnalisis: "2026-10-09T12:00:00.000Z",
    });
    expect(dto.explicacion).toContain("Las reglas suman");
    expect(dto.senales.length).toBeGreaterThan(0);
    const cohecho = dto.supuestos.find(
      (c) => c.fragmentoId === "ANEXO_C-III-b",
    );
    expect(cohecho?.texto).toContain(
      "Cohecho pasivo: El servidor público que recibe",
    );
    expect(cohecho?.senalesQueLaMotivan.length).toBeGreaterThan(0);
    expect(dto.procedimiento.map((c) => c.fragmentoId)).toContain(
      "AM-DENUNCIA-CORRUPCION",
    );
    expect(dto.fichaDerivacion).toMatchObject({ codigoEntidad: "sis" });
  });

  it("los requisitos que faltan salen con el texto de la ayuda memoria de OTRANS", async () => {
    const fila = await filaGuardada(TEXTO);
    const dto = construirAnalisisDto("MINSA-2026-000001", fila);
    const codigos = dto.requisitosFaltantes.map((r) => r.codigo);
    expect(codigos).toContain("pruebas");
    const pruebas = dto.requisitosFaltantes.find((r) => r.codigo === "pruebas");
    expect(pruebas?.texto).toContain(
      "Podrá acompañarse de documentación que le dé sustento.",
    );
    expect(pruebas?.referencia).toContain("Ayuda memoria OTRANS");
  });

  it("lleva el nombre y el cargo mencionados como datos informativos, y el área solo si existe", async () => {
    const fila = await filaGuardada(TEXTO);
    const dto = construirAnalisisDto("MINSA-2026-000001", fila);
    expect(dto.cargoMencionado).toBe(fila.cargoMencionado);
    expect(dto.nombreMencionado).toBe(fila.nombreMencionado);
    expect(dto.areaMencionada).toBeNull();
    const conArea = construirAnalisisDto("MINSA-2026-000001", {
      ...fila,
      areaMencionadaCodigo: "sis",
      areaMencionadaNombre: "Seguro Integral de Salud",
    });
    expect(conArea.areaMencionada).toEqual({
      codigo: "sis",
      nombre: "Seguro Integral de Salud",
    });
  });

  it("con el modelo caído lo dice y el motivo de escritura es la duda sin modelo o las reglas", async () => {
    const dto = construirAnalisisDto(
      "MINSA-2026-000001",
      await filaGuardada(TEXTO, true),
    );
    expect(dto.modelo).toMatchObject({ degradado: true, pesoIa: null });
    expect(dto.motivoDeEscritura).toBe("REGLAS");
  });

  it("un fragmento que ya no existe en las normas se muestra sin texto, sin romper", async () => {
    const fila = await filaGuardada(TEXTO);
    const dto = construirAnalisisDto("MINSA-2026-000001", fila, {
      ...DATOS_NORMAS,
      fragmentos: [],
    });
    expect(dto.supuestos.length).toBeGreaterThan(0);
    expect(
      dto.supuestos.every((c) => c.texto === null && c.referencia.length > 0),
    ).toBe(true);
    expect(dto.requisitosFaltantes).toEqual([]);
  });

  it("un análisis escrito por otro proceso (jsonb vacío o con otra forma) se lee sin romper", () => {
    const base: FilaAnalisis = {
      versionReglas: "reglas-corrupcion-v1.2",
      puntaje: 3,
      senales: {},
      cargoMencionado: null,
      nombreMencionado: null,
      areaMencionadaCodigo: null,
      areaMencionadaNombre: null,
      categoriaIa: null,
      confianzaIa: null,
      versionClasificador: null,
      fechaAnalisis: new Date("2026-10-09T12:00:00.000Z"),
    };
    for (const senales of [
      {},
      null,
      "texto",
      [],
      { senales: "x", normas: 3, decision: [] },
    ]) {
      const dto = construirAnalisisDto("MINSA-2026-000002", {
        ...base,
        senales,
      });
      expect(dto).toMatchObject({
        categoriaIa: null,
        motivoDeEscritura: null,
        explicacion: null,
        senales: [],
        supuestos: [],
        procedimiento: [],
        requisitosFaltantes: [],
        etiquetaNormas: ETIQUETA_REFERENCIA_ORIENTATIVA,
      });
    }
  });

  it("no incluye el texto del ciudadano ni la explicación del modelo: solo lo que guardó el clasificador", async () => {
    const dto = construirAnalisisDto(
      "MINSA-2026-000001",
      await filaGuardada(TEXTO),
    );
    expect(JSON.stringify(dto)).not.toContain("me pidió plata para atenderme");
  });
});
