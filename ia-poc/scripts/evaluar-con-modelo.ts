// Evalúa reglas + modelo local (Ollama) contra un conjunto de mensajes etiquetados (JSON Lines).
// Uso (desde la raíz del repo):
//   npx tsx ia-poc/scripts/evaluar-con-modelo.ts --variante=V1|V2|V3 --conjunto=ia-poc/evaluacion/desarrollo.jsonl [--limite=N [--estratificado]] [--max-minutos=35] [--solo-cache]
// Una sola GPU: se consulta de a un mensaje. Cada respuesta válida se guarda en `ia-poc/evaluacion/cache/modelo-<variante>-<conjunto>.jsonl`
// (por variante e id) y una corrida cortada se reanuda sola. El resumen se guarda SIN textos en `ia-poc/evaluacion/resultados/modelo-<variante>-<conjunto>.json`.
// Antes de correr: `node ia-poc/scripts/precalentar.mjs` (la primera llamada en frío tarda unos 2 minutos).
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { MotivoFalloIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import {
  analizarMensaje,
  pesoEfectivoDelModelo,
} from "@/services/analisis-ia/analizar-mensaje.js";
import type {
  ClienteModelo,
  MetricasModelo,
  PaqueteAnalisis,
  ResultadoConsulta,
} from "@/services/analisis-ia/analisis-ia.types.js";
import { crearClienteOllama } from "@/services/analisis-ia/cliente-ollama.js";
import type { SalidaModelo } from "@/services/analisis-ia/esquema-salida.js";
import { combinarReglasConIa } from "@/services/filtro-corrupcion/combinar-reglas-con-ia.js";

interface Mensaje {
  id: string;
  texto: string;
  categoria_esperada: string;
  tipo_caso?: string | null;
}

interface LineaDeCache {
  id: string;
  variante: VarianteIa;
  salida: SalidaModelo;
  metricas: MetricasModelo;
}

interface Metricas {
  total: number;
  positivos: number;
  vp: number;
  fn: number;
  fp: number;
  vn: number;
  recall: number | null;
  precision: number | null;
}

interface Fila {
  mensaje: Mensaje;
  paquete: PaqueteAnalisis;
  esperadoCorrupcion: boolean;
}

const CATEGORIAS = Object.values(CategoriaIncidencia);
const { DENUNCIA_CORRUPCION, QUEJA, RECLAMO } = CategoriaIncidencia;
const PESOS = Array.from({ length: 11 }, (_, i) => i);
const PISOS_DE_SENSIBILIDAD: readonly (number | null)[] = [null, 4, 5, 6, 8];
const MINUTO_MS = 60_000;

const argumentos = process.argv.slice(2);
const valorDe = (nombre: string): string | undefined =>
  argumentos
    .find((a) => a.startsWith(`--${nombre}=`))
    ?.slice(nombre.length + 3);
const variante = valorDe("variante") as VarianteIa | undefined;
const rutaConjunto = valorDe("conjunto");
const limite = valorDe("limite") ? Number(valorDe("limite")) : undefined;
const maxMinutos = valorDe("max-minutos")
  ? Number(valorDe("max-minutos"))
  : undefined;
const estratificado = argumentos.includes("--estratificado");
const soloCache = argumentos.includes("--solo-cache");

if (
  !variante ||
  !Object.values(VarianteIa).includes(variante) ||
  !rutaConjunto
) {
  console.error(
    "Uso: --variante=V1|V2|V3 --conjunto=<ruta.jsonl> [--limite=N] [--max-minutos=N] [--solo-cache]",
  );
  process.exit(2);
}

const nombreConjunto = basename(rutaConjunto).replace(/\.jsonl$/, "");
const carpetaEvaluacion = resolve("ia-poc/evaluacion");
const rutaCache = resolve(
  carpetaEvaluacion,
  "cache",
  `modelo-${variante}-${nombreConjunto}.jsonl`,
);
const rutaResultado = resolve(
  carpetaEvaluacion,
  "resultados",
  `modelo-${variante}-${nombreConjunto}.json`,
);
mkdirSync(resolve(carpetaEvaluacion, "cache"), { recursive: true });

const leerLineas = <T>(ruta: string): T[] =>
  existsSync(ruta)
    ? readFileSync(ruta, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as T)
    : [];

const parametros = JSON.parse(
  readFileSync(resolve("ia-poc/modelo/parametros.json"), "utf8"),
) as {
  modelo: string;
  servidor: string;
  keep_alive: string;
  options: Record<string, number>;
};
const clienteOllama = crearClienteOllama({
  modelo: parametros.modelo,
  url: parametros.servidor,
  keepAlive: parametros.keep_alive,
  opciones: parametros.options,
});

const cache = new Map(
  leerLineas<LineaDeCache>(rutaCache)
    .filter((l) => l.variante === variante)
    .map((l) => [l.id, l]),
);
const todos = leerLineas<Mensaje>(resolve(rutaConjunto));
/** Subconjunto reproducible: de cada grupo (tipo_caso y categoría) toma, repartidos por igual, los que le tocan según su peso en el conjunto. */
function muestraEstratificada(
  lista: readonly Mensaje[],
  cuantos: number,
): Mensaje[] {
  const grupos = new Map<string, Mensaje[]>();
  for (const m of lista)
    grupos.set(`${m.tipo_caso ?? ""}|${m.categoria_esperada}`, [
      ...(grupos.get(`${m.tipo_caso ?? ""}|${m.categoria_esperada}`) ?? []),
      m,
    ]);
  const elegidos: Mensaje[] = [];
  for (const grupo of grupos.values()) {
    const tomar = Math.max(
      1,
      Math.round((grupo.length / lista.length) * cuantos),
    );
    for (let i = 0; i < tomar && i < grupo.length; i++) {
      const elegido = grupo[Math.floor((i * grupo.length) / tomar)];
      if (elegido) elegidos.push(elegido);
    }
  }
  return elegidos
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, Math.max(cuantos, 0) + grupos.size);
}
const mensajes = limite
  ? estratificado
    ? muestraEstratificada(todos, limite)
    : todos.slice(0, limite)
  : todos;

/** Cliente que responde desde la caché y, si no hay, consulta a Ollama y guarda la respuesta válida. */
const clienteCacheado = (id: string): ClienteModelo => ({
  async consultar(peticion): Promise<ResultadoConsulta> {
    const guardado = cache.get(id);
    if (guardado)
      return { ok: true, salida: guardado.salida, metricas: guardado.metricas };
    if (soloCache)
      return {
        ok: false,
        motivo: MotivoFalloIa.SIN_CONEXION,
        metricas: { ...SIN_METRICAS },
      };
    const resultado = await clienteOllama.consultar(peticion);
    if (resultado.ok) {
      const linea: LineaDeCache = {
        id,
        variante: variante as VarianteIa,
        salida: resultado.salida,
        metricas: resultado.metricas,
      };
      cache.set(id, linea);
      appendFileSync(rutaCache, JSON.stringify(linea) + "\n");
    }
    return resultado;
  },
});
const SIN_METRICAS: MetricasModelo = {
  intentos: 0,
  duracionMs: 0,
  totalOllamaMs: null,
  cargaModeloMs: null,
  procesoPromptMs: null,
  generacionMs: null,
  tokensPrompt: null,
  tokensSalida: null,
};

const razon = (n: number, d: number): number | null => (d === 0 ? null : n / d);
const porcentaje = (v: number | null): string =>
  v === null ? "n/d" : `${(v * 100).toFixed(1)}%`;
const redondear = (v: number | null, d = 3): number | null =>
  v === null ? null : Math.round(v * 10 ** d) / 10 ** d;

function metricasDe(
  filas: readonly Fila[],
  predicho: (f: Fila) => boolean,
): Metricas {
  const vp = filas.filter((f) => f.esperadoCorrupcion && predicho(f)).length;
  const fn = filas.filter((f) => f.esperadoCorrupcion && !predicho(f)).length;
  const fp = filas.filter((f) => !f.esperadoCorrupcion && predicho(f)).length;
  return {
    total: filas.length,
    positivos: vp + fn,
    vp,
    fn,
    fp,
    vn: filas.length - vp - fn - fp,
    recall: razon(vp, vp + fn),
    precision: razon(vp, vp + fp),
  };
}

const percentil = (ordenados: readonly number[], p: number): number | null => {
  if (ordenados.length === 0) return null;
  return (
    ordenados[
      Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)
    ] ?? null
  );
};
const media = (v: readonly number[]): number | null =>
  v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;

const inicio = Date.now();
const filas: Fila[] = [];
let cortadoPorTiempo = false;
let consultasNuevas = 0;

for (const [indice, mensaje] of mensajes.entries()) {
  if (maxMinutos && Date.now() - inicio > maxMinutos * MINUTO_MS) {
    cortadoPorTiempo = true;
    console.log(
      `Tope de ${maxMinutos} minutos alcanzado: se corta en ${indice} de ${mensajes.length}.`,
    );
    break;
  }
  const estabaEnCache = cache.has(mensaje.id);
  const t0 = Date.now();
  const paquete = await analizarMensaje(
    mensaje.texto,
    {},
    { variante, cliente: clienteCacheado(mensaje.id) },
  );
  if (!estabaEnCache) consultasNuevas++;
  filas.push({
    mensaje,
    paquete,
    esperadoCorrupcion: mensaje.categoria_esperada === DENUNCIA_CORRUPCION,
  });
  const estado = paquete.degradado
    ? `FALLO ${paquete.motivoDegradado}`
    : `${paquete.salidaModelo?.categoria ?? "-"} peso=${paquete.pesoIa ?? "-"}`;
  console.log(
    `[${indice + 1}/${mensajes.length}] ${mensaje.id} ${estado} (${estabaEnCache ? "caché" : `${((Date.now() - t0) / 1000).toFixed(1)} s`})`,
  );
}

const consultadas = filas.filter((f) => f.paquete.reglas.aplica);
const conSalida = consultadas.filter((f) => f.paquete.salidaModelo !== null);
const latencias = consultadas
  .map((f) => f.paquete.metricas?.duracionMs ?? 0)
  .filter((v) => v > 0)
  .sort((a, b) => a - b);
const primerIntento = conSalida.filter(
  (f) => f.paquete.metricas?.intentos === 1,
).length;

const soloReglas = metricasDe(
  filas,
  (f) => f.paquete.reglas.propuestaCorrupcion,
);
const reglasMasIa = metricasDe(
  filas,
  (f) => f.paquete.combinacion.propuestaCorrupcion,
);
const perdidasPorReglas = filas.filter(
  (f) => f.esperadoCorrupcion && !f.paquete.reglas.propuestaCorrupcion,
);
const recuperadas = perdidasPorReglas.filter(
  (f) => f.paquete.combinacion.propuestaCorrupcion,
);
const falsosNuevos = filas.filter(
  (f) =>
    !f.esperadoCorrupcion &&
    !f.paquete.reglas.propuestaCorrupcion &&
    f.paquete.combinacion.propuestaCorrupcion,
);
const negativos = filas.filter((f) => !f.esperadoCorrupcion);
const tasaFpNegativos = (predicho: (f: Fila) => boolean): number | null =>
  razon(negativos.filter(predicho).length, negativos.length);
const tiposDeCaso = [
  ...new Set(filas.map((f) => f.mensaje.tipo_caso ?? "(sin dato)")),
].sort();
const porTipoDeCaso = Object.fromEntries(
  tiposDeCaso.map((tipo) => {
    const grupo = filas.filter(
      (f) => (f.mensaje.tipo_caso ?? "(sin dato)") === tipo,
    );
    const esperadosNegativos = grupo.filter((f) => !f.esperadoCorrupcion);
    return [
      tipo,
      {
        total: grupo.length,
        corrupcionEsperada: grupo.length - esperadosNegativos.length,
        recallSoloReglas: redondear(
          razon(
            grupo.filter(
              (f) =>
                f.esperadoCorrupcion && f.paquete.reglas.propuestaCorrupcion,
            ).length,
            grupo.length - esperadosNegativos.length,
          ),
        ),
        recallReglasMasIa: redondear(
          razon(
            grupo.filter(
              (f) =>
                f.esperadoCorrupcion &&
                f.paquete.combinacion.propuestaCorrupcion,
            ).length,
            grupo.length - esperadosNegativos.length,
          ),
        ),
        negativos: esperadosNegativos.length,
        fpSoloReglas: esperadosNegativos.filter(
          (f) => f.paquete.reglas.propuestaCorrupcion,
        ).length,
        fpReglasMasIa: esperadosNegativos.filter(
          (f) => f.paquete.combinacion.propuestaCorrupcion,
        ).length,
      },
    ];
  }),
);
const corrupcionAlEstablecimiento = filas.filter(
  (f) => f.esperadoCorrupcion && f.paquete.propuesta !== DENUNCIA_CORRUPCION,
);
const corrupcionConRevisionOtrans = corrupcionAlEstablecimiento.filter(
  (f) => f.paquete.revisionOtrans,
);

// Exactitud de las 4 categorías del modelo y matriz de confusión (filas: esperada; columnas: la que dio el modelo).
const matriz: Record<string, Record<string, number>> = Object.fromEntries(
  CATEGORIAS.map((e) => [e, Object.fromEntries(CATEGORIAS.map((c) => [c, 0]))]),
);
for (const f of conSalida) {
  const fila = matriz[f.mensaje.categoria_esperada];
  const categoria = f.paquete.salidaModelo?.categoria;
  if (fila && categoria) fila[categoria] = (fila[categoria] ?? 0) + 1;
}
const aciertosCategoria = conSalida.filter(
  (f) => f.paquete.salidaModelo?.categoria === f.mensaje.categoria_esperada,
).length;

// Queja frente a reclamo: solo mensajes esperados QUEJA o RECLAMO.
const esQuejaOReclamo = (c: string | undefined): boolean =>
  c === QUEJA || c === RECLAMO;
const quejaReclamo = conSalida.filter((f) =>
  esQuejaOReclamo(f.mensaje.categoria_esperada),
);
const quejaReclamoDelModelo = quejaReclamo.filter((f) =>
  esQuejaOReclamo(f.paquete.salidaModelo?.categoria),
);
const acuerdoQuejaReclamoModelo = quejaReclamoDelModelo.filter(
  (f) => f.paquete.salidaModelo?.categoria === f.mensaje.categoria_esperada,
).length;
const quejaReclamoFinal = quejaReclamo.filter((f) =>
  esQuejaOReclamo(f.paquete.propuesta),
);
const acuerdoQuejaReclamoFinal = quejaReclamoFinal.filter(
  (f) => f.paquete.propuesta === f.mensaje.categoria_esperada,
).length;
const empates = quejaReclamo.filter((f) => f.paquete.empateQuejaReclamo).length;

// Distribución del peso (0 a 10) por categoría esperada.
const distribucionPeso: Record<string, number[]> = Object.fromEntries(
  CATEGORIAS.map((c) => [c, PESOS.map(() => 0)]),
);
for (const f of conSalida) {
  const fila = distribucionPeso[f.mensaje.categoria_esperada];
  const peso = f.paquete.pesoIa;
  if (fila && peso !== null && fila[peso] !== undefined) fila[peso]++;
}

const idsDesacuerdo = {
  categoriaDelModelo: conSalida
    .filter(
      (f) => f.paquete.salidaModelo?.categoria !== f.mensaje.categoria_esperada,
    )
    .map((f) => f.mensaje.id),
  propuestaFinal: filas
    .filter((f) => f.paquete.propuesta !== f.mensaje.categoria_esperada)
    .map((f) => f.mensaje.id),
};

// Sensibilidad (sin llamar al modelo): ¿qué pasaría si `posible_corrupcion` subiera el peso al menos a un piso?
const sensibilidad = PISOS_DE_SENSIBILIDAD.map((piso) => {
  const recalculadas = filas.map((f) => ({
    ...f,
    paquete: {
      ...f.paquete,
      combinacion: combinarReglasConIa(
        f.paquete.reglas,
        f.paquete.salidaModelo
          ? pesoEfectivoDelModelo(f.paquete.salidaModelo, piso)
          : null,
      ),
    },
  }));
  const m = metricasDe(
    recalculadas,
    (f) => f.paquete.combinacion.propuestaCorrupcion,
  );
  return {
    piso,
    ...m,
    recall: redondear(m.recall),
    precision: redondear(m.precision),
  };
});

const resumen = {
  variante,
  conjunto: nombreConjunto,
  modelo: parametros.modelo,
  mensajes: filas.length,
  cortadoPorTiempo,
  consultasNuevasEstaCorrida: consultasNuevas,
  jsonValido: {
    consultadas: consultadas.length,
    conSalidaValida: conSalida.length,
    tasa: redondear(razon(conSalida.length, consultadas.length)),
    validosAlPrimerIntento: primerIntento,
    fallos: consultadas
      .filter((f) => f.paquete.salidaModelo === null)
      .map((f) => ({ id: f.mensaje.id, motivo: f.paquete.motivoDegradado })),
  },
  latenciaMs: {
    media: redondear(media(latencias), 0),
    mediana: percentil(latencias, 0.5),
    p90: percentil(latencias, 0.9),
    total: latencias.reduce((a, b) => a + b, 0),
    tokensSalidaMedia: redondear(
      media(
        conSalida
          .map((f) => f.paquete.metricas?.tokensSalida ?? 0)
          .filter((v) => v > 0),
      ),
      1,
    ),
  },
  corrupcion: {
    soloReglas: {
      ...soloReglas,
      recall: redondear(soloReglas.recall),
      precision: redondear(soloReglas.precision),
    },
    reglasMasIa: {
      ...reglasMasIa,
      recall: redondear(reglasMasIa.recall),
      precision: redondear(reglasMasIa.precision),
    },
    negativos: negativos.length,
    tasaFalsosPositivosSobreNegativos: {
      soloReglas: redondear(
        tasaFpNegativos((f) => f.paquete.reglas.propuestaCorrupcion),
      ),
      reglasMasIa: redondear(
        tasaFpNegativos((f) => f.paquete.combinacion.propuestaCorrupcion),
      ),
    },
    porTipoDeCaso,
    perdidasPorLasReglas: perdidasPorReglas.length,
    recuperadasPorElModelo: {
      total: recuperadas.length,
      ids: recuperadas.map((f) => f.mensaje.id),
    },
    falsosPositivosNuevos: {
      total: falsosNuevos.length,
      ids: falsosNuevos.map((f) => f.mensaje.id),
    },
    corrupcionQueSigueAlEstablecimiento: {
      total: corrupcionAlEstablecimiento.length,
      conRevisionOtrans: corrupcionConRevisionOtrans.length,
      ids: corrupcionAlEstablecimiento.map((f) => f.mensaje.id),
    },
  },
  categoriasDelModelo: {
    exactitud: redondear(razon(aciertosCategoria, conSalida.length)),
    aciertos: aciertosCategoria,
    de: conSalida.length,
    matrizEsperadaPorModelo: matriz,
  },
  quejaFrenteAReclamo: {
    esperadosQuejaOReclamo: quejaReclamo.length,
    modeloDioQuejaOReclamo: quejaReclamoDelModelo.length,
    acuerdoDelModelo: redondear(
      razon(acuerdoQuejaReclamoModelo, quejaReclamoDelModelo.length),
    ),
    propuestaFinalQuejaOReclamo: quejaReclamoFinal.length,
    acuerdoDeLaPropuestaFinal: redondear(
      razon(acuerdoQuejaReclamoFinal, quejaReclamoFinal.length),
    ),
    empatesPropuestosComoReclamo: empates,
  },
  distribucionPesoPorCategoriaEsperada: distribucionPeso,
  idsConDesacuerdo: idsDesacuerdo,
  sensibilidadAlPisoDePosibleCorrupcion: sensibilidad,
};

writeFileSync(rutaResultado, JSON.stringify(resumen, null, 2) + "\n");

console.log(
  `\n=== ${variante} sobre ${nombreConjunto} (${filas.length} mensajes, ${consultasNuevas} consultas nuevas) ===`,
);
console.log(
  `JSON válido: ${conSalida.length}/${consultadas.length} (${porcentaje(razon(conSalida.length, consultadas.length))}); al primer intento ${primerIntento}`,
);
console.log(
  `Latencia ms: media ${resumen.latenciaMs.media}, mediana ${resumen.latenciaMs.mediana}, p90 ${resumen.latenciaMs.p90}, total ${(resumen.latenciaMs.total / 1000).toFixed(0)} s`,
);
const linea = (nombre: string, m: Metricas): string =>
  `${nombre}: VP=${m.vp} FN=${m.fn} FP=${m.fp} VN=${m.vn} recall=${porcentaje(m.recall)} precisión=${porcentaje(m.precision)}`;
console.log(linea("Solo reglas ", soloReglas));
console.log(linea("Reglas + IA ", reglasMasIa));
console.log(
  `Recuperadas: ${recuperadas.length}/${perdidasPorReglas.length} | FP nuevos: ${falsosNuevos.length} | corrupción que sigue al establecimiento: ${corrupcionAlEstablecimiento.length}`,
);
console.log(
  `Tasa de FP sobre negativos: solo reglas ${porcentaje(resumen.corrupcion.tasaFalsosPositivosSobreNegativos.soloReglas)}, reglas + IA ${porcentaje(resumen.corrupcion.tasaFalsosPositivosSobreNegativos.reglasMasIa)} (${negativos.length} negativos)`,
);
for (const [tipo, t] of Object.entries(porTipoDeCaso))
  console.log(
    `  ${tipo.padEnd(26)} n=${t.total} recall ${porcentaje(t.recallSoloReglas)} -> ${porcentaje(t.recallReglasMasIa)} | FP ${t.fpSoloReglas} -> ${t.fpReglasMasIa} de ${t.negativos}`,
  );
console.log(
  `Categorías del modelo: ${aciertosCategoria}/${conSalida.length} (${porcentaje(razon(aciertosCategoria, conSalida.length))})`,
);
console.log(
  `Queja vs reclamo: modelo ${acuerdoQuejaReclamoModelo}/${quejaReclamoDelModelo.length}, propuesta final ${acuerdoQuejaReclamoFinal}/${quejaReclamoFinal.length}, empates ${empates}`,
);
console.log(`Resumen guardado en ${rutaResultado}`);
