import {
  MODELO_POR_DEFECTO,
  OLLAMA_KEEP_ALIVE_POR_DEFECTO,
  OLLAMA_OPCIONES_POR_DEFECTO,
  OLLAMA_URL_POR_DEFECTO,
  VARIANTE_POR_DEFECTO,
} from "@/constants/analisis-ia.js";
import { TIEMPO_MAXIMO_MODELO_CLASIFICADOR_MS } from "@/constants/clasificador.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import { crearClienteOllama } from "@/services/analisis-ia/cliente-ollama.js";
import type { AnalizadorDeCaso } from "@/services/clasificador/clasificador.service.js";

export interface ConfiguracionAnalizador {
  url?: string;
  modelo?: string;
}

/**
 * El análisis que usa el trabajador: reglas y V2C (la variante por defecto) con Ollama en localhost. El tiempo máximo del modelo se
 * acota (`TIEMPO_MAXIMO_MODELO_CLASIFICADOR_MS`) porque la fila del caso queda bloqueada mientras responde; si se agota, degrada a solo
 * reglas. No lleva reintentos propios: el cliente ya reintenta una vez los errores de red.
 */
export function crearAnalizadorDeProduccion(
  configuracion: ConfiguracionAnalizador = {},
): { analizar: AnalizadorDeCaso; modelo: string } {
  const modelo = configuracion.modelo ?? MODELO_POR_DEFECTO;
  const cliente = crearClienteOllama({
    url: configuracion.url ?? OLLAMA_URL_POR_DEFECTO,
    modelo,
    keepAlive: OLLAMA_KEEP_ALIVE_POR_DEFECTO,
    opciones: OLLAMA_OPCIONES_POR_DEFECTO,
    tiempoMaximoMs: TIEMPO_MAXIMO_MODELO_CLASIFICADOR_MS,
  });
  return {
    modelo,
    analizar: (texto, contexto) =>
      analizarMensaje(texto, contexto, {
        variante: VARIANTE_POR_DEFECTO,
        cliente,
      }),
  };
}
