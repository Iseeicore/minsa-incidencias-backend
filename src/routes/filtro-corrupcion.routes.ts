import { Router } from "express";
import { z } from "zod";
import { ENTIDADES_EVALUACION_MAXIMO, TEXTO_EVALUACION_MAXIMO } from "@/constants/filtro-corrupcion.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { requireRol } from "@/middleware/session.js";
import { combinarReglasConIa } from "@/services/filtro-corrupcion/combinar-reglas-con-ia.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";

const NOMBRE_ENTIDAD_MAXIMO = 200;

const entidadSchema = z.object({
  codigo: z.string().trim().min(1).max(50),
  nombre: z.string().trim().min(1).max(NOMBRE_ENTIDAD_MAXIMO),
  alias: z.array(z.string().trim().min(1).max(NOMBRE_ENTIDAD_MAXIMO)).max(20).optional(),
});

const evaluacionSchema = z.object({
  texto: z.string().max(TEXTO_EVALUACION_MAXIMO),
  entidades: z.array(entidadSchema).max(ENTIDADES_EVALUACION_MAXIMO).optional(),
  establecimientoConocido: z.boolean().optional(),
  tieneArchivos: z.boolean().optional(),
  /** Peso de 0 a 10 que dio el modelo (`null`: el modelo no estuvo disponible). Si llega (aunque sea `null`), la respuesta suma `combinacion`. */
  pesoIa: z.number().nullable().optional(),
});

/**
 * Herramienta interna de solo lectura para probar el filtro de corrupción por reglas: no toca la base ni cambia ningún
 * caso, y no registra el texto. Devuelve una propuesta; la categoría y el destino de un caso siguen decidiéndose con
 * las acciones de `/incidencias` y las reglas de la base. Sin `entidades` en el cuerpo se usa el catálogo oficial generado.
 * Con `pesoIa` (0 a 10, o `null` si el modelo no estuvo disponible) devuelve además `combinacion`: el modelo no decide, su peso se suma al puntaje.
 */
export function createFiltroCorrupcionRouter(): Router {
  const router = Router();
  const puedeProbar = requireRol(RolCodigo.ADMINISTRADOR, RolCodigo.GESTOR, RolCodigo.OTRANS);

  router.post("/filtro-corrupcion/evaluar", puedeProbar, (req, res) => {
    const { texto, pesoIa, ...contexto } = evaluacionSchema.parse(req.body ?? {});
    const resultado = evaluarTextoCorrupcion(texto, contexto);
    // Sin `pesoIa` en el cuerpo la respuesta es la de siempre; con él se agrega la combinación reglas + modelo.
    res.json(pesoIa === undefined ? resultado : { ...resultado, combinacion: combinarReglasConIa(resultado, pesoIa) });
  });

  return router;
}
