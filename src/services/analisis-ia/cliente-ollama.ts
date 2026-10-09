import {
  MODELO_POR_DEFECTO,
  OLLAMA_KEEP_ALIVE_POR_DEFECTO,
  OLLAMA_OPCIONES_POR_DEFECTO,
  OLLAMA_URL_POR_DEFECTO,
  REINTENTOS_MODELO,
  TIEMPO_MAXIMO_MODELO_MS,
} from "@/constants/analisis-ia.js";
import { MotivoFalloIa } from "@/enums/analisis-ia.enum.js";
import type {
  ClienteModelo,
  MetricasModelo,
  PeticionModelo,
  ResultadoConsulta,
} from "@/services/analisis-ia/analisis-ia.types.js";
import {
  esquemaSalidaJson,
  validarSalidaModelo,
} from "@/services/analisis-ia/esquema-salida.js";

export interface ConfiguracionOllama {
  url: string;
  modelo: string;
  keepAlive: string;
  opciones: Readonly<Record<string, number>>;
  tiempoMaximoMs: number;
  reintentos: number;
  /** Se inyecta en las pruebas; por defecto el `fetch` global. */
  fetchFn: typeof fetch;
}

export const CONFIGURACION_OLLAMA_POR_DEFECTO: ConfiguracionOllama = {
  url: OLLAMA_URL_POR_DEFECTO,
  modelo: MODELO_POR_DEFECTO,
  keepAlive: OLLAMA_KEEP_ALIVE_POR_DEFECTO,
  opciones: OLLAMA_OPCIONES_POR_DEFECTO,
  tiempoMaximoMs: TIEMPO_MAXIMO_MODELO_MS,
  reintentos: REINTENTOS_MODELO,
  fetchFn: (...argumentos) => fetch(...argumentos),
};

const NS_POR_MS = 1_000_000;

const numeroONulo = (valor: unknown): number | null =>
  typeof valor === "number" && Number.isFinite(valor) ? valor : null;
const nsAMs = (valor: unknown): number | null => {
  const n = numeroONulo(valor);
  return n === null ? null : Math.round(n / NS_POR_MS);
};

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

type Intento =
  | {
      ok: true;
      resultado: Extract<ResultadoConsulta, { ok: true }>["salida"];
      metricas: Partial<MetricasModelo>;
    }
  | {
      ok: false;
      motivo: MotivoFalloIa;
      reintentable: boolean;
      metricas: Partial<MetricasModelo>;
    };

function metricasDeRespuesta(
  cuerpo: Record<string, unknown>,
): Partial<MetricasModelo> {
  return {
    totalOllamaMs: nsAMs(cuerpo.total_duration),
    cargaModeloMs: nsAMs(cuerpo.load_duration),
    procesoPromptMs: nsAMs(cuerpo.prompt_eval_duration),
    generacionMs: nsAMs(cuerpo.eval_duration),
    tokensPrompt: numeroONulo(cuerpo.prompt_eval_count),
    tokensSalida: numeroONulo(cuerpo.eval_count),
  };
}

/** Una llamada a `/api/chat`. Nunca lanza: todo fallo vuelve como motivo. */
async function unIntento(
  config: ConfiguracionOllama,
  peticion: PeticionModelo,
  esquema: Record<string, unknown>,
): Promise<Intento> {
  let respuesta: Response;
  try {
    respuesta = await config.fetchFn(`${config.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(config.tiempoMaximoMs),
      body: JSON.stringify({
        model: config.modelo,
        stream: false,
        think: false,
        keep_alive: config.keepAlive,
        format: esquema,
        options: config.opciones,
        messages: [
          { role: "system", content: peticion.sistema },
          { role: "user", content: peticion.usuario },
        ],
      }),
    });
  } catch (error) {
    const agotado =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      motivo: agotado
        ? MotivoFalloIa.TIEMPO_AGOTADO
        : MotivoFalloIa.SIN_CONEXION,
      reintentable: !agotado,
      metricas: {},
    };
  }
  if (!respuesta.ok)
    return {
      ok: false,
      motivo: MotivoFalloIa.ERROR_HTTP,
      reintentable: respuesta.status >= 500,
      metricas: {},
    };

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    return {
      ok: false,
      motivo: MotivoFalloIa.JSON_INVALIDO,
      reintentable: true,
      metricas: {},
    };
  }
  if (!esRegistro(cuerpo))
    return {
      ok: false,
      motivo: MotivoFalloIa.RESPUESTA_VACIA,
      reintentable: true,
      metricas: {},
    };
  const metricas = metricasDeRespuesta(cuerpo);
  const contenido = esRegistro(cuerpo.message)
    ? cuerpo.message.content
    : undefined;
  if (typeof contenido !== "string" || contenido.trim() === "")
    return {
      ok: false,
      motivo: MotivoFalloIa.RESPUESTA_VACIA,
      reintentable: true,
      metricas,
    };

  let cruda: unknown;
  try {
    cruda = JSON.parse(contenido);
  } catch {
    return {
      ok: false,
      motivo: MotivoFalloIa.JSON_INVALIDO,
      reintentable: true,
      metricas,
    };
  }
  const validacion = validarSalidaModelo(cruda);
  if (!validacion.ok)
    return {
      ok: false,
      motivo: MotivoFalloIa.ESQUEMA_INVALIDO,
      reintentable: true,
      metricas,
    };
  return { ok: true, resultado: validacion.salida, metricas };
}

const completarMetricas = (
  parcial: Partial<MetricasModelo>,
  intentos: number,
  duracionMs: number,
): MetricasModelo => ({
  intentos,
  duracionMs,
  totalOllamaMs: parcial.totalOllamaMs ?? null,
  cargaModeloMs: parcial.cargaModeloMs ?? null,
  procesoPromptMs: parcial.procesoPromptMs ?? null,
  generacionMs: parcial.generacionMs ?? null,
  tokensPrompt: parcial.tokensPrompt ?? null,
  tokensSalida: parcial.tokensSalida ?? null,
});

/**
 * Cliente de Ollama (`/api/chat`, sin streaming, razonamiento apagado, salida con el esquema). Un reintento con el mismo prompt si el
 * JSON no valida o hay un error de red o 5xx; un tiempo agotado no se reintenta. NUNCA lanza ni registra texto: devuelve `{ok:false, motivo}`.
 */
export function crearClienteOllama(
  parcial: Partial<ConfiguracionOllama> = {},
): ClienteModelo {
  const config: ConfiguracionOllama = {
    ...CONFIGURACION_OLLAMA_POR_DEFECTO,
    ...parcial,
  };
  const esquema = esquemaSalidaJson();
  return {
    async consultar(peticion) {
      const inicio = Date.now();
      let intentos = 0;
      let ultimo: Intento | null = null;
      try {
        while (intentos <= config.reintentos) {
          intentos++;
          ultimo = await unIntento(config, peticion, esquema);
          if (ultimo.ok || !ultimo.reintentable) break;
        }
      } catch {
        return {
          ok: false,
          motivo: MotivoFalloIa.ERROR_INESPERADO,
          metricas: completarMetricas({}, intentos, Date.now() - inicio),
        };
      }
      const metricas = completarMetricas(
        ultimo?.metricas ?? {},
        intentos,
        Date.now() - inicio,
      );
      if (ultimo?.ok) return { ok: true, salida: ultimo.resultado, metricas };
      return {
        ok: false,
        motivo:
          ultimo?.ok === false ? ultimo.motivo : MotivoFalloIa.ERROR_INESPERADO,
        metricas,
      };
    },
  };
}
