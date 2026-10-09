import {
  ALARMA_CODIGOS_MAXIMOS,
  MAXIMO_INTENTOS_POR_CASO,
  UMBRAL_ALARMA_SIN_CLASIFICAR_MINUTOS,
  VERSION_CLASIFICADOR_SIN_MODELO,
} from "@/constants/clasificador.js";
import { ACTOR_SISTEMA_CLASIFICADOR } from "@/database/actor.js";
import type { Database } from "@/database/database.js";
import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import type { MotivoDeEscritura } from "@/enums/clasificador.enum.js";
import type {
  ContextoAnalisis,
  PaqueteAnalisis,
} from "@/services/analisis-ia/analisis-ia.types.js";
import {
  construirVersionClasificador,
  decidirEscritura,
} from "@/services/clasificador/regla-de-escritura.js";
import { construirSenalesGuardadas } from "@/services/clasificador/senales-guardadas.js";

/** El análisis detrás de una interfaz: en producción es `analizarMensaje` con V2C; en las pruebas, un simulado. */
export type AnalizadorDeCaso = (
  texto: string,
  contexto: ContextoAnalisis,
) => Promise<PaqueteAnalisis>;

export const ResultadoClasificacion = {
  CLASIFICADA: "CLASIFICADA",
  COLA_VACIA: "COLA_VACIA",
  FALLO: "FALLO",
} as const;
export type ResultadoClasificacion =
  (typeof ResultadoClasificacion)[keyof typeof ResultadoClasificacion];

export type SalidaDeClasificar =
  | {
      resultado: typeof ResultadoClasificacion.CLASIFICADA;
      codigo: string;
      categoria: CategoriaIncidencia;
      confianza: number;
      motivo: MotivoDeEscritura;
      degradado: boolean;
    }
  | { resultado: typeof ResultadoClasificacion.COLA_VACIA }
  | {
      resultado: typeof ResultadoClasificacion.FALLO;
      id: string;
      codigo: string;
      intentos: number;
      /** Código del error (el `code` de PostgreSQL o el nombre del error), nunca su mensaje: puede traer datos del caso. */
      codigoDeError: string;
      /** `true` si ya se reintentó el máximo y este proceso deja de intentarlo. */
      abandonado: boolean;
    };

const codigoDelError = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string") return code;
    if (typeof name === "string") return name;
  }
  return "ERROR_DESCONOCIDO";
};

interface FilaPendiente {
  id: string;
  codigo: string;
  descripcion: string;
  establecimiento: string | null;
}

/**
 * Toma el caso más antiguo sin clasificar. `FOR UPDATE SKIP LOCKED`: varios trabajadores pueden correr a la vez sin pisarse ni esperar
 * (cada uno salta lo que otro tiene tomado). Solo casos abiertos (REGISTRADO) y sin categoría de la IA. Los ids que ya fallaron el
 * máximo de veces en este proceso se excluyen para que un caso roto no tape a los demás.
 */
export const CONSULTA_SIGUIENTE_PENDIENTE = `SELECT i.id, i.codigo, i.descripcion, e.nombre AS establecimiento
  FROM chatbot.incidencia_paciente i
  LEFT JOIN catalogo.establecimiento_salud e ON e.id = i.establecimiento_id
 WHERE i.estado_incidencia_id = 1
   AND i.categoria_ia_id IS NULL
   AND i.activo
   AND NOT (i.id = ANY($1::uuid[]))
 ORDER BY i.fecha_creacion, i.id
 LIMIT 1
 FOR UPDATE OF i SKIP LOCKED`;

/** Si el caso nombra una entidad que existe como área (por su código), la guarda; si no, queda sin área. */
const CONSULTA_AREA_MENCIONADA = `SELECT id FROM catalogo.area WHERE lower(codigo) = lower($1) AND activo LIMIT 1`;

const INSERTAR_ANALISIS = `INSERT INTO chatbot.incidencia_analisis
    (incidencia_paciente_id, version_reglas, puntaje, senales, cargo_mencionado, area_mencionada_id, nombre_mencionado)
  VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
  ON CONFLICT (incidencia_paciente_id) DO NOTHING`;

/** `categoria_ia_id` se escribe una sola vez: la condición `IS NULL` hace que reintentar no pueda pisar una clasificación ya hecha. */
const ACTUALIZAR_CATEGORIA = `UPDATE chatbot.incidencia_paciente
    SET categoria_ia_id = (SELECT id FROM catalogo.categoria_incidencia WHERE codigo = $2),
        categoria_confianza = $3,
        version_clasificador = $4
  WHERE id = $1 AND categoria_ia_id IS NULL`;

export interface OpcionesClasificador {
  database: Database;
  analizar: AnalizadorDeCaso;
  /** Nombre del modelo, para `version_clasificador`. */
  modelo: string;
  maximoIntentos?: number;
}

/**
 * B1, trabajador clasificador. Por cada caso REGISTRADO sin categoría, en UNA transacción con actor `sistema:clasificador`: lo toma
 * (`SKIP LOCKED`), lo analiza (reglas y V2C), y escribe `incidencia_analisis` más `categoria_ia_id`, `categoria_confianza` y
 * `version_clasificador`. La base lo pasa a CLASIFICADO y lo destina (la corrupción, a OTRANS). Si algo falla la transacción se revierte
 * entera: el caso sigue pendiente y se reintenta sin duplicar. Si el modelo cae, `analizarMensaje` degrada a solo reglas y se escribe
 * ese resultado (nunca queda sin clasificar por culpa del modelo). El bot no llama al análisis. No registra textos.
 */
export class ClasificadorIncidencias {
  private readonly fallos = new Map<string, number>();
  private readonly maximoIntentos: number;

  constructor(private readonly opciones: OpcionesClasificador) {
    this.maximoIntentos = opciones.maximoIntentos ?? MAXIMO_INTENTOS_POR_CASO;
  }

  /** Ids que este proceso dejó de intentar tras el máximo de fallos. */
  get abandonados(): string[] {
    return [...this.fallos.entries()]
      .filter(([, intentos]) => intentos >= this.maximoIntentos)
      .map(([id]) => id);
  }

  async clasificarSiguiente(): Promise<SalidaDeClasificar> {
    let pendiente: FilaPendiente | null = null;
    try {
      return await this.opciones.database.transaction(
        ACTOR_SISTEMA_CLASIFICADOR,
        async (tx) => {
          const [fila] = await tx.query<FilaPendiente>(
            CONSULTA_SIGUIENTE_PENDIENTE,
            [this.abandonados],
          );
          if (!fila)
            return { resultado: ResultadoClasificacion.COLA_VACIA } as const;
          pendiente = fila;

          const paquete = await this.opciones.analizar(fila.descripcion, {
            ...(fila.establecimiento
              ? {
                  establecimiento: fila.establecimiento,
                  establecimientoConocido: true,
                }
              : {}),
          });
          const decision = decidirEscritura(paquete);
          const version = construirVersionClasificador(
            paquete,
            this.opciones.modelo,
            VERSION_CLASIFICADOR_SIN_MODELO,
          );
          const entidad = paquete.reglas.entidad?.codigo ?? null;
          const [area] = entidad
            ? await tx.query<{ id: number }>(CONSULTA_AREA_MENCIONADA, [
                entidad,
              ])
            : [];

          await tx.query(INSERTAR_ANALISIS, [
            fila.id,
            paquete.reglas.versionReglas,
            paquete.reglas.puntaje,
            JSON.stringify(construirSenalesGuardadas(paquete, decision)),
            paquete.reglas.actor?.cargo ?? null,
            area?.id ?? null,
            paquete.reglas.nombreMencionado,
          ]);
          await tx.query(ACTUALIZAR_CATEGORIA, [
            fila.id,
            decision.categoria,
            decision.confianza,
            version,
          ]);

          this.fallos.delete(fila.id);
          return {
            resultado: ResultadoClasificacion.CLASIFICADA,
            codigo: fila.codigo,
            categoria: decision.categoria,
            confianza: decision.confianza,
            motivo: decision.motivo,
            degradado: paquete.degradado,
          } as const;
        },
      );
    } catch (error) {
      // La transacción se revirtió: el caso sigue pendiente. No se registra el error (puede traer el texto del caso).
      const tomado = pendiente as FilaPendiente | null;
      if (!tomado)
        throw new Error(
          "No se pudo consultar la cola de casos sin clasificar.",
        );
      const intentos = (this.fallos.get(tomado.id) ?? 0) + 1;
      this.fallos.set(tomado.id, intentos);
      return {
        resultado: ResultadoClasificacion.FALLO,
        id: tomado.id,
        codigo: tomado.codigo,
        intentos,
        codigoDeError: codigoDelError(error),
        abandonado: intentos >= this.maximoIntentos,
      };
    }
  }
}

export interface ResumenDeCola {
  clasificadas: number;
  fallos: number;
  abandonadas: number;
  degradadas: number;
  /** Casos clasificados que la regla de escritura mandó a OTRANS como corrupción o duda. */
  aOtrans: number;
}

/**
 * Procesa la cola hasta vaciarla (o hasta `maximoCasos`). Sale al llegar a un caso que falla para no girar sobre él: el siguiente
 * ciclo del trabajador lo reintenta (y tras el máximo de intentos lo deja fuera).
 */
export async function vaciarCola(
  clasificador: ClasificadorIncidencias,
  maximoCasos = Number.POSITIVE_INFINITY,
): Promise<ResumenDeCola> {
  const resumen: ResumenDeCola = {
    clasificadas: 0,
    fallos: 0,
    abandonadas: 0,
    degradadas: 0,
    aOtrans: 0,
  };
  while (resumen.clasificadas + resumen.fallos < maximoCasos) {
    const salida = await clasificador.clasificarSiguiente();
    if (salida.resultado === ResultadoClasificacion.COLA_VACIA) break;
    if (salida.resultado === ResultadoClasificacion.FALLO) {
      resumen.fallos++;
      if (salida.abandonado) resumen.abandonadas++;
      continue;
    }
    resumen.clasificadas++;
    if (salida.degradado) resumen.degradadas++;
    if (salida.categoria === "DENUNCIA_CORRUPCION") resumen.aOtrans++;
  }
  return resumen;
}

export interface AlarmaSinClasificar {
  /** Casos sin clasificar que llevan más del umbral esperando. */
  atrasados: number;
  /** Minutos del más antiguo; `null` si no hay. */
  minutosDelMasAntiguo: number | null;
  /** Códigos (nunca textos) de los más antiguos. */
  codigos: string[];
  activa: boolean;
}

/** Alarma por antigüedad: casos REGISTRADO sin categoría de la IA con más de `minutos` esperando (por defecto 10). Solo lectura. */
export async function consultarAlarmaSinClasificar(
  database: Pick<Database, "query">,
  minutos = UMBRAL_ALARMA_SIN_CLASIFICAR_MINUTOS,
): Promise<AlarmaSinClasificar> {
  const [fila] = await database.query<{
    atrasados: number;
    minutos: number | null;
    codigos: string[] | null;
  }>(
    `SELECT count(*)::int AS atrasados,
            round((extract(epoch FROM (now() - min(fecha_creacion))) / 60)::numeric, 1)::float8 AS minutos,
            (array_agg(codigo ORDER BY fecha_creacion, id))[1:$2] AS codigos
       FROM chatbot.incidencia_paciente
      WHERE estado_incidencia_id = 1
        AND categoria_ia_id IS NULL
        AND activo
        AND fecha_creacion < now() - make_interval(mins => $1::int)`,
    [minutos, ALARMA_CODIGOS_MAXIMOS],
  );
  const atrasados = fila?.atrasados ?? 0;
  return {
    atrasados,
    minutosDelMasAntiguo: atrasados > 0 ? (fila?.minutos ?? null) : null,
    codigos: fila?.codigos ?? [],
    activa: atrasados > 0,
  };
}
