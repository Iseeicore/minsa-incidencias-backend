import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";

export const MENSAJE_ACCION_REALIZADA: Record<AccionIncidencia, string> = {
  [AccionIncidencia.CONFIRMAR]: "Categoría confirmada. Se guardó para mejorar la IA.",
  [AccionIncidencia.CORREGIR]: "Categoría corregida. Se guardó para mejorar la IA.",
  [AccionIncidencia.DERIVAR]: "Caso derivado al área.",
  [AccionIncidencia.TOMAR]: "Caso tomado en gestión.",
  [AccionIncidencia.RESOLVER]: "Caso resuelto.",
};

export const MENSAJE_ACCION_NO_PERMITIDA: Record<AccionIncidencia, string> = {
  [AccionIncidencia.CONFIRMAR]: "No puedes confirmar la categoría de este caso.",
  [AccionIncidencia.CORREGIR]: "No puedes corregir la categoría de este caso.",
  [AccionIncidencia.DERIVAR]: "No puedes derivar este caso.",
  [AccionIncidencia.TOMAR]: "No puedes tomar este caso en gestión.",
  [AccionIncidencia.RESOLVER]: "No puedes resolver este caso.",
};

export const MENSAJE_CASO_NO_ENCONTRADO = "El caso solicitado no existe.";
export const MENSAJE_MISMA_CATEGORIA = "La nueva categoría es igual a la actual.";
export const MENSAJE_FALTA_CATEGORIA = "Indica la categoría nueva.";
export const MENSAJE_FALTA_RESOLUCION = "Escribe el texto de la resolución.";

export const mensajeCategoriaCorregidaFueraDeVista = (etiqueta: string): string =>
  `Categoría corregida a ${etiqueta}. El caso pasó al área correspondiente y ya no aparece en tu lista. Se guardó para mejorar la IA.`;
