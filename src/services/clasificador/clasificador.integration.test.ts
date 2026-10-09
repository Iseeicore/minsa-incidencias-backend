import { describe, expect, it, vi } from "vitest";
import { MotivoFalloIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia as C } from "@/enums/categoria-incidencia.enum.js";
import { MotivoDeEscritura } from "@/enums/clasificador.enum.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type {
  ClienteModelo,
  MetricasModelo,
} from "@/services/analisis-ia/analisis-ia.types.js";
import type { SalidaCompacta } from "@/services/analisis-ia/esquema-salida.js";
import {
  ClasificadorIncidencias,
  CONSULTA_SIGUIENTE_PENDIENTE,
  consultarAlarmaSinClasificar,
  ResultadoClasificacion,
  vaciarCola,
  type AnalizadorDeCaso,
} from "@/services/clasificador/clasificador.service.js";
import { crearEstablecimientoDePrueba } from "@/test-utils/establecimientos.js";
import { sembrarCaso } from "@/test-utils/incidencias.js";
import {
  withRollbackDatabase,
  type RollbackContext,
} from "@/test-utils/rollback-database.js";

const url = process.env["TEST_DATABASE_URL"];

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
      categoria: C.RECLAMO,
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
    motivo: MotivoFalloIa.TIEMPO_AGOTADO,
    metricas: METRICAS,
  }),
};
const analizarCon =
  (cliente: ClienteModelo, piso?: number | null): AnalizadorDeCaso =>
  (texto, contexto) =>
    analizarMensaje(texto, contexto, {
      variante: VarianteIa.V2C,
      cliente,
      ...(piso !== undefined ? { pisoPesoPosibleCorrupcion: piso } : {}),
    });

const TEXTO_COBRO = "El director del hospital me pidió plata para atenderme";
const TEXTO_NEUTRO =
  "Quiero saber a qué hora abre la farmacia del hospital por las tardes";
const TEXTO_ZONA_GRIS =
  "El director del Hospital Dos de Mayo pide cosas a los pacientes que pagaron en caja";

const clasificador = (
  contexto: RollbackContext,
  analizar: AnalizadorDeCaso,
  maximoIntentos?: number,
) =>
  new ClasificadorIncidencias({
    database: contexto.database,
    analizar,
    modelo: "modelo-de-prueba",
    ...(maximoIntentos !== undefined ? { maximoIntentos } : {}),
  });

/** La base de pruebas puede traer casos pendientes de antes: se clasifican primero (dentro de la transacción de la prueba, que se revierte). */
const vaciarPendientesPrevios = (contexto: RollbackContext) =>
  vaciarCola(clasificador(contexto, analizarCon(modelo())));

interface FilaEstado {
  categoriaIa: string | null;
  categoriaId: string | null;
  estado: string;
  confianza: number | null;
  version: string | null;
  areaDestino: string | null;
  analisis: number;
}

async function estadoDe(
  { client }: RollbackContext,
  id: string,
): Promise<FilaEstado> {
  const { rows } = await client.query<FilaEstado>(
    `SELECT cia.codigo AS "categoriaIa", cat.codigo AS "categoriaId", e.codigo AS estado,
            i.categoria_confianza::float8 AS confianza, i.version_clasificador AS version,
            a.codigo AS "areaDestino",
            (SELECT count(*)::int FROM chatbot.incidencia_analisis x WHERE x.incidencia_paciente_id = i.id) AS analisis
       FROM chatbot.incidencia_paciente i
       JOIN catalogo.estado_incidencia e ON e.id = i.estado_incidencia_id
       LEFT JOIN catalogo.categoria_incidencia cia ON cia.id = i.categoria_ia_id
       LEFT JOIN catalogo.categoria_incidencia cat ON cat.id = i.categoria_id
       LEFT JOIN catalogo.area a ON a.id = i.area_destino_id
      WHERE i.id = $1`,
    [id],
  );
  return rows[0] as FilaEstado;
}

async function analisisDe({ client }: RollbackContext, id: string) {
  const { rows } = await client.query<{
    version_reglas: string;
    puntaje: number;
    senales: Record<string, unknown>;
    usuario_creacion: string;
    cargo_mencionado: string | null;
  }>(
    `SELECT version_reglas, puntaje::int, senales, usuario_creacion, cargo_mencionado
       FROM chatbot.incidencia_analisis WHERE incidencia_paciente_id = $1`,
    [id],
  );
  return rows;
}

describe.skipIf(!url)("clasificador (B1) contra PostgreSQL real", () => {
  const usar = (prueba: (contexto: RollbackContext) => Promise<void>) =>
    withRollbackDatabase(url as string, prueba);

  it("una corrupción se escribe como DENUNCIA_CORRUPCION y la base la destina a OTRANS, con el análisis guardado en la misma transacción", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const eess = await crearEstablecimientoDePrueba(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: null,
        establecimiento: eess,
        marcador: TEXTO_COBRO,
      });
      expect((await estadoDe(contexto, caso.id)).estado).toBe("REGISTRADO");

      const salida = await clasificador(
        contexto,
        analizarCon(modelo()),
      ).clasificarSiguiente();
      expect(salida).toMatchObject({
        resultado: ResultadoClasificacion.CLASIFICADA,
        codigo: caso.codigo,
        categoria: C.DENUNCIA_CORRUPCION,
        motivo: MotivoDeEscritura.REGLAS,
      });

      const estado = await estadoDe(contexto, caso.id);
      expect(estado).toMatchObject({
        categoriaIa: "DENUNCIA_CORRUPCION",
        categoriaId: "DENUNCIA_CORRUPCION",
        estado: "CLASIFICADO",
        areaDestino: "OTRANS",
        analisis: 1,
      });
      expect(estado.confianza).toBeGreaterThan(0);
      expect(estado.confianza).toBeLessThanOrEqual(95);
      expect(estado.version).toMatch(
        /^reglas-corrupcion-v[\d.]+\+modelo-de-prueba\+V2C$/,
      );

      const [analisis] = await analisisDe(contexto, caso.id);
      expect(analisis).toMatchObject({
        usuario_creacion: "sistema:clasificador",
      });
      expect(analisis?.puntaje).toBeGreaterThan(0);
      expect(analisis?.cargo_mencionado).toBeTruthy();
      const senales = analisis?.senales as {
        decision: { motivo: string; categoriaEscrita: string };
        normas: { etiqueta: string; citas: { fragmentoId: string }[] };
        explicacion: string;
        modelo: { variante: string };
      };
      expect(senales.decision).toMatchObject({
        motivo: "REGLAS",
        categoriaEscrita: "DENUNCIA_CORRUPCION",
      });
      expect(senales.normas.etiqueta).toBe(
        "Referencia orientativa; la califica OTRANS.",
      );
      expect(senales.normas.citas.map((c) => c.fragmentoId)).toContain(
        "ANEXO_C-III-b",
      );
      expect(senales.explicacion).toContain("Las reglas suman");
      expect(senales.modelo.variante).toBe("V2C");
      // Ni el texto del ciudadano ni el texto literal de las normas se guardan en el análisis.
      expect(JSON.stringify(senales)).not.toContain(
        "me pidió plata para atenderme relato",
      );
      expect(JSON.stringify(senales)).not.toContain(
        "El servidor público que recibe",
      );
    });
  });

  it("una queja se escribe tal cual y la base la destina al establecimiento de origen", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const eess = await crearEstablecimientoDePrueba(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: null,
        establecimiento: eess,
        marcador: TEXTO_NEUTRO,
      });
      await clasificador(
        contexto,
        analizarCon(modelo({ categoria: C.QUEJA })),
      ).clasificarSiguiente();
      expect(await estadoDe(contexto, caso.id)).toMatchObject({
        categoriaIa: "QUEJA",
        estado: "CLASIFICADO",
        areaDestino: eess.areaCodigo,
        analisis: 1,
      });
      const [analisis] = await analisisDe(contexto, caso.id);
      expect(
        (analisis?.senales as { decision: { motivo: string } }).decision.motivo,
      ).toBe(MotivoDeEscritura.SIN_CORRUPCION);
    });
  });

  it("la duda de corrupción también va a OTRANS, con confianza de a lo más 55 y el motivo guardado", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const eess = await crearEstablecimientoDePrueba(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: null,
        establecimiento: eess,
        marcador: TEXTO_NEUTRO,
      });
      await clasificador(
        contexto,
        analizarCon(
          modelo({
            categoria: C.DENUNCIA_CORRUPCION,
            peso_corrupcion: 2,
            posible_corrupcion: true,
          }),
          null,
        ),
      ).clasificarSiguiente();
      const estado = await estadoDe(contexto, caso.id);
      expect(estado).toMatchObject({
        categoriaIa: "DENUNCIA_CORRUPCION",
        areaDestino: "OTRANS",
        estado: "CLASIFICADO",
      });
      expect(estado.confianza).toBeLessThanOrEqual(55);
      const [analisis] = await analisisDe(contexto, caso.id);
      expect(
        (
          analisis?.senales as {
            decision: { motivo: string; propuestaDelAnalisis: string };
          }
        ).decision,
      ).toMatchObject({
        motivo: "DUDA_DEL_MODELO",
        propuestaDelAnalisis: "RECLAMO",
      });
    });
  });

  it("si el modelo cae, se escribe el resultado de las reglas (nunca queda sin clasificar) y la versión lo dice", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const corrupcion = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_COBRO,
      });
      const zonaGris = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_ZONA_GRIS,
      });
      const resumen = await vaciarCola(
        clasificador(contexto, analizarCon(modeloCaido)),
      );
      expect(resumen).toMatchObject({
        clasificadas: 2,
        fallos: 0,
        degradadas: 2,
        aOtrans: 2,
      });

      const a = await estadoDe(contexto, corrupcion.id);
      expect(a).toMatchObject({
        categoriaIa: "DENUNCIA_CORRUPCION",
        areaDestino: "OTRANS",
      });
      expect(a.version).toMatch(/\+solo-reglas$/);
      const b = await estadoDe(contexto, zonaGris.id);
      expect(b.categoriaIa).toBe("DENUNCIA_CORRUPCION");
      expect(b.confianza).toBeLessThanOrEqual(55);
      const [analisis] = await analisisDe(contexto, zonaGris.id);
      expect(
        analisis?.senales as {
          decision: { motivo: string };
          modelo: { degradado: boolean };
        },
      ).toMatchObject({
        decision: { motivo: "DUDA_SIN_MODELO" },
        modelo: { degradado: true },
      });
    });
  });

  it("reintentar no duplica: la segunda pasada no encuentra casos y el análisis sigue siendo una sola fila", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_COBRO,
      });
      const trabajador = clasificador(contexto, analizarCon(modelo()));
      expect((await vaciarCola(trabajador)).clasificadas).toBe(1);
      expect(await trabajador.clasificarSiguiente()).toEqual({
        resultado: ResultadoClasificacion.COLA_VACIA,
      });
      expect((await vaciarCola(trabajador)).clasificadas).toBe(0);
      expect((await estadoDe(contexto, caso.id)).analisis).toBe(1);
    });
  });

  it("un caso que ya tiene categoría de la IA no se vuelve a tomar ni se pisa", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: C.OTRO,
        confianza: 61,
      });
      const analizar = vi.fn(analizarCon(modelo()));
      expect(
        (await vaciarCola(clasificador(contexto, analizar))).clasificadas,
      ).toBe(0);
      expect(analizar).not.toHaveBeenCalled();
      expect(await estadoDe(contexto, caso.id)).toMatchObject({
        categoriaIa: "OTRO",
        confianza: 61,
        analisis: 0,
      });
    });
  });

  it("si la escritura falla, la transacción se revierte entera: el caso sigue pendiente y sin análisis, y el siguiente intento lo clasifica", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_COBRO,
      });
      let falla = true;
      const analizar: AnalizadorDeCaso = async (texto, ctx) => {
        if (falla) throw new Error(`falla simulada con el texto ${texto}`);
        return analizarCon(modelo())(texto, ctx);
      };
      const trabajador = clasificador(contexto, analizar);

      const primero = await trabajador.clasificarSiguiente();
      expect(primero).toMatchObject({
        resultado: ResultadoClasificacion.FALLO,
        codigo: caso.codigo,
        intentos: 1,
        abandonado: false,
      });
      // El código del error nunca trae el mensaje (puede contener el texto del caso).
      expect(JSON.stringify(primero)).not.toContain("falla simulada");
      expect(await estadoDe(contexto, caso.id)).toMatchObject({
        categoriaIa: null,
        estado: "REGISTRADO",
        analisis: 0,
      });

      falla = false;
      expect(await trabajador.clasificarSiguiente()).toMatchObject({
        resultado: ResultadoClasificacion.CLASIFICADA,
      });
      expect(await estadoDe(contexto, caso.id)).toMatchObject({
        categoriaIa: "DENUNCIA_CORRUPCION",
        analisis: 1,
      });
    });
  });

  it("un error de la base a mitad de la escritura (con el análisis ya insertado) revierte todo", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_COBRO,
      });
      const trabajador = clasificador(contexto, analizarCon(modelo()));
      // Se rompe el UPDATE de la categoría (columna inexistente) justo después de insertar el análisis.
      const original = contexto.database.transaction.bind(contexto.database);
      contexto.database.transaction = (actor, trabajo) =>
        original(actor, (tx) =>
          trabajo({
            query: (sql: string, valores?: unknown[]) =>
              tx.query(
                sql.includes("UPDATE chatbot.incidencia_paciente")
                  ? sql.replace(
                      "SET categoria_ia_id =",
                      "SET categoria_ia_id_inexistente =",
                    )
                  : sql,
                valores,
              ),
          } as typeof tx),
        );
      const salida = await trabajador.clasificarSiguiente();
      contexto.database.transaction = original;
      expect(salida).toMatchObject({
        resultado: ResultadoClasificacion.FALLO,
        codigoDeError: "42703",
      });
      expect(await estadoDe(contexto, caso.id)).toMatchObject({
        categoriaIa: null,
        estado: "REGISTRADO",
        analisis: 0,
      });
      // Sin el daño, el siguiente intento lo clasifica con una sola fila de análisis.
      expect(await trabajador.clasificarSiguiente()).toMatchObject({
        resultado: ResultadoClasificacion.CLASIFICADA,
      });
      expect(await estadoDe(contexto, caso.id)).toMatchObject({
        categoriaIa: "DENUNCIA_CORRUPCION",
        analisis: 1,
      });
    });
  });

  it("un caso roto no tapa a los demás: tras el máximo de intentos se deja fuera y se sigue con el siguiente", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const roto = await sembrarCaso(contexto, {
        categoria: null,
        marcador: "este caso rompe el analizador, relato de prueba",
      });
      const sano = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_NEUTRO,
      });
      const analizar: AnalizadorDeCaso = async (texto, ctx) => {
        if (texto.includes("rompe el analizador")) throw new Error("roto");
        return analizarCon(modelo({ categoria: C.QUEJA }))(texto, ctx);
      };
      const trabajador = clasificador(contexto, analizar, 2);
      const resumen = await vaciarCola(trabajador);
      expect(resumen).toMatchObject({ clasificadas: 1, abandonadas: 1 });
      expect(resumen.fallos).toBe(2);
      expect(trabajador.abandonados).toHaveLength(1);
      expect(await estadoDe(contexto, sano.id)).toMatchObject({
        categoriaIa: "QUEJA",
      });
      expect(await estadoDe(contexto, roto.id)).toMatchObject({
        categoriaIa: null,
        estado: "REGISTRADO",
      });
      // Fuera del conteo de los abandonados, el caso sigue contando para la alarma si espera mucho.
      expect(
        (await consultarAlarmaSinClasificar(contexto.database, 0)).atrasados,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("la cola se toma con FOR UPDATE SKIP LOCKED, del más antiguo al más nuevo, solo casos abiertos sin categoría de la IA", () => {
    expect(CONSULTA_SIGUIENTE_PENDIENTE).toContain(
      "FOR UPDATE OF i SKIP LOCKED",
    );
    expect(CONSULTA_SIGUIENTE_PENDIENTE).toContain(
      "i.estado_incidencia_id = 1",
    );
    expect(CONSULTA_SIGUIENTE_PENDIENTE).toContain("i.categoria_ia_id IS NULL");
    expect(CONSULTA_SIGUIENTE_PENDIENTE).toContain("ORDER BY i.fecha_creacion");
  });

  it("alarma: un caso sin clasificar con más de 10 minutos la enciende y clasificarlo la apaga; los recientes no cuentan", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      expect(
        (await consultarAlarmaSinClasificar(contexto.database)).activa,
      ).toBe(false);

      const viejo = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_NEUTRO,
        edadHoras: 1,
      });
      await sembrarCaso(contexto, { categoria: null, marcador: TEXTO_NEUTRO });
      const alarma = await consultarAlarmaSinClasificar(contexto.database);
      expect(alarma).toMatchObject({
        activa: true,
        atrasados: 1,
        codigos: [viejo.codigo],
      });
      expect(alarma.minutosDelMasAntiguo).toBeGreaterThanOrEqual(59);

      await vaciarCola(clasificador(contexto, analizarCon(modelo())));
      expect(
        (await consultarAlarmaSinClasificar(contexto.database)).activa,
      ).toBe(false);
    });
  });

  it("el actor del análisis y de la clasificación es sistema:clasificador (queda en la auditoría de la base)", async () => {
    await usar(async (contexto) => {
      await vaciarPendientesPrevios(contexto);
      const caso = await sembrarCaso(contexto, {
        categoria: null,
        marcador: TEXTO_COBRO,
      });
      await clasificador(contexto, analizarCon(modelo())).clasificarSiguiente();
      const { rows } = await contexto.client.query<{ actor: string }>(
        `SELECT a.actor FROM chatbot.incidencia_paciente_auditoria a
          WHERE a.incidencia_paciente_id = $1 AND a.operacion = 'ACTUALIZACION'
          ORDER BY a.fecha_hora DESC LIMIT 1`,
        [caso.id],
      );
      expect(rows[0]?.actor).toBe("sistema:clasificador");
    });
  });
});
