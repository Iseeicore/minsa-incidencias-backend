import { Router } from "express";
import { z } from "zod";
import {
  ESTABLECIMIENTO_MAXIMO_CARACTERES,
  RUTA_ANALISIS_IA,
} from "@/constants/analisis-ia.js";
import { TEXTO_EVALUACION_MAXIMO } from "@/constants/filtro-corrupcion.js";
import { VarianteIa } from "@/enums/analisis-ia.enum.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { requireRol } from "@/middleware/session.js";
import { analizarMensaje } from "@/services/analisis-ia/analizar-mensaje.js";
import type { RecuperadorCasos } from "@/services/analisis-ia/casos/casos.types.js";
import type {
  ContextoAnalisis,
  OpcionesAnalisis,
  PaqueteAnalisis,
} from "@/services/analisis-ia/analisis-ia.types.js";

export type Analizador = (
  texto: string,
  contexto: ContextoAnalisis,
  opciones: OpcionesAnalisis,
) => Promise<PaqueteAnalisis>;

const analisisSchema = z.object({
  texto: z.string().max(TEXTO_EVALUACION_MAXIMO),
  variante: z
    .enum(Object.values(VarianteIa) as [VarianteIa, ...VarianteIa[]])
    .optional(),
  establecimiento: z
    .string()
    .trim()
    .min(1)
    .max(ESTABLECIMIENTO_MAXIMO_CARACTERES)
    .optional(),
});

/**
 * Prueba de la PoC de IA, solo lectura y solo para ADMINISTRADOR: reglas + modelo local sobre un texto. No guarda nada, no toca el
 * registro de incidencias ni el bot, y no registra el texto. Se monta únicamente con `IA_POC_HABILITADA=true`; apagada, la ruta no
 * existe (404). El modelo corre en localhost: el texto no sale de la máquina. Con `recuperarCasos` (solo lectura de
 * `ia.entrenamiento_categoria`) la variante V2R recibe casos parecidos ya revisados; sin él corre sin ejemplos.
 */
export function createIaPocRouter(
  analizar: Analizador = analizarMensaje,
  recuperarCasos?: RecuperadorCasos,
): Router {
  const router = Router();

  router.post(
    RUTA_ANALISIS_IA,
    requireRol(RolCodigo.ADMINISTRADOR),
    async (req, res) => {
      const { texto, variante, establecimiento } = analisisSchema.parse(
        req.body ?? {},
      );
      res.json(
        await analizar(
          texto,
          {
            ...(establecimiento
              ? { establecimiento, establecimientoConocido: true }
              : {}),
          },
          {
            ...(variante ? { variante } : {}),
            ...(recuperarCasos ? { recuperarCasos } : {}),
          },
        ),
      );
    },
  );

  return router;
}
