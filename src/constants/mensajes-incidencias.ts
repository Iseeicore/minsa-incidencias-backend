import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";

export const MENSAJE_ACCION_REALIZADA: Record<AccionIncidencia, string> = {
  [AccionIncidencia.CONFIRMAR]: "Categoría confirmada. Se guardó para mejorar la IA.",
  [AccionIncidencia.CORREGIR]: "Categoría corregida. Se guardó para mejorar la IA.",
  [AccionIncidencia.DERIVAR]: "Caso derivado al área.",
  [AccionIncidencia.TOMAR]: "Caso tomado en gestión.",
  [AccionIncidencia.RESOLVER]: "Caso resuelto.",
  [AccionIncidencia.ARCHIVAR]: "Caso archivado.",
  [AccionIncidencia.REABRIR]: "Caso reabierto. Quedó en gestión.",
};

export const MENSAJE_ACCION_NO_PERMITIDA: Record<AccionIncidencia, string> = {
  [AccionIncidencia.CONFIRMAR]: "No puedes confirmar la categoría de este caso.",
  [AccionIncidencia.CORREGIR]: "No puedes corregir la categoría de este caso.",
  [AccionIncidencia.DERIVAR]: "No puedes derivar este caso.",
  [AccionIncidencia.TOMAR]: "No puedes tomar este caso en gestión.",
  [AccionIncidencia.RESOLVER]: "No puedes resolver este caso.",
  [AccionIncidencia.ARCHIVAR]: "No puedes archivar este caso.",
  [AccionIncidencia.REABRIR]: "No puedes reabrir este caso.",
};

export const MENSAJE_CASO_NO_ENCONTRADO = "El caso solicitado no existe.";
export const MENSAJE_MISMA_CATEGORIA = "La nueva categoría es igual a la actual.";
export const MENSAJE_FALTA_CATEGORIA = "Indica la categoría nueva.";
export const MENSAJE_CATEGORIA_NO_PERMITIDA = "No puedes cambiar el caso a esa categoría.";
export const MENSAJE_SIN_DESTINO_DE_DERIVACION = "El caso no tiene un área de destino: indica el área para derivarlo.";
export const MENSAJE_AREA_DESTINO_INVALIDA = "El área de destino no existe, está desactivada o no recibe este tipo de caso.";
export const MENSAJE_FALTA_RESOLUCION = "Escribe las medidas tomadas, el fundamento y el resultado.";
export const MENSAJE_FALTA_MOTIVO_DE_ARCHIVO = "Indica el motivo y el detalle del archivo.";
export const MENSAJE_FALTA_MOTIVO_DE_REAPERTURA = "Indica el motivo de la reapertura.";

export const mensajeCategoriaCorregidaFueraDeVista = (etiqueta: string): string =>
  `Categoría corregida a ${etiqueta}. El caso pasó al área correspondiente y ya no aparece en tu lista. Se guardó para mejorar la IA.`;
