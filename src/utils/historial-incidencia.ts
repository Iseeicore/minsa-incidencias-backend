import {
  ACTOR_PREFIJO_SISTEMA,
  CATEGORIA_ETIQUETA,
  HORAS_POR_DIA,
  NOMBRE_ACTOR_SISTEMA,
} from "@/constants/incidencias.js";
import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { horasEntre } from "@/utils/plazo-incidencia.js";

export interface FilaHistorial {
  operacion: "CREACION" | "ACTUALIZACION";
  actor: string;
  actorNombre: string | null;
  fechaHora: Date;
  ia: boolean;
  categoriaIa: CategoriaIncidencia | null;
  confianza: number | null;
  version: string | null;
  corregida: boolean;
  categoriaAntes: CategoriaIncidencia | null;
  categoriaDespues: CategoriaIncidencia | null;
  confirmada: boolean;
  estadoNuevo: EstadoIncidencia | null;
  resolvio: boolean;
  reabrio: boolean;
}

export interface ItemDeHistorial {
  titulo: string;
  detalle: string;
  hora: string;
  fecha: string;
}

const HORAS_HASTA_CONTAR_EN_DIAS = HORAS_POR_DIA * 2;
const ACTOR_DESCONOCIDO = "una persona";

export function textoHace(horas: number): string {
  if (horas < 1) return "hace menos de 1 h";
  if (horas < HORAS_HASTA_CONTAR_EN_DIAS) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / HORAS_POR_DIA)} d`;
}

function quienHizo(fila: FilaHistorial): string {
  if (fila.actorNombre) return fila.actorNombre;
  return fila.actor.startsWith(ACTOR_PREFIJO_SISTEMA) ? NOMBRE_ACTOR_SISTEMA : ACTOR_DESCONOCIDO;
}

const etiqueta = (categoria: CategoriaIncidencia | null): string => (categoria ? CATEGORIA_ETIQUETA[categoria] : "sin categoría");

function detalleDeLaClasificacion(fila: FilaHistorial): string {
  let texto = fila.categoriaIa ? etiqueta(fila.categoriaIa) : "Clasificado";
  if (fila.confianza !== null) texto += ` con ${fila.confianza} % de confianza`;
  if (fila.version) texto += ` (clasificador ${fila.version})`;
  return `${texto}.`;
}

function describirHito(fila: FilaHistorial): { titulo: string; detalle: string } | null {
  if (fila.resolvio) return { titulo: "Caso resuelto", detalle: `Por ${quienHizo(fila)}.` };
  if (fila.reabrio) return { titulo: "Caso reabierto", detalle: `Por ${quienHizo(fila)}.` };
  if (fila.estadoNuevo === EstadoIncidencia.ARCHIVADO) return { titulo: "Archivado", detalle: `Por ${quienHizo(fila)}.` };
  if (fila.estadoNuevo === EstadoIncidencia.DERIVADO) return { titulo: "Derivado al área", detalle: `Por ${quienHizo(fila)}.` };
  if (fila.estadoNuevo === EstadoIncidencia.EN_GESTION) return { titulo: "Tomado en gestión", detalle: `Por ${quienHizo(fila)}.` };
  if (fila.corregida) {
    return {
      titulo: "Categoría corregida",
      detalle: `De ${etiqueta(fila.categoriaAntes)} a ${etiqueta(fila.categoriaDespues)}, por ${quienHizo(fila)}.`,
    };
  }
  if (fila.confirmada) return { titulo: "Categoría confirmada", detalle: `Por ${quienHizo(fila)}.` };
  if (fila.ia) return { titulo: "La IA clasificó el caso", detalle: detalleDeLaClasificacion(fila) };
  return null;
}

/**
 * Convierte los cambios guardados de un caso en los hitos que ve la persona: recibido, clasificado por la IA,
 * revisado, derivado, tomado, resuelto o archivado. Solo usa el nombre de quien actuó, nunca su correo ni el
 * contenido del caso. Los cambios que no son un hito se omiten.
 */
export function construirHistorial(filas: readonly FilaHistorial[], canal: string, ahora: Date): ItemDeHistorial[] {
  const items: ItemDeHistorial[] = [];
  for (const fila of filas) {
    const hito =
      fila.operacion === "CREACION"
        ? { titulo: `Recibido por ${canal}`, detalle: "Registrado como incidencia." }
        : describirHito(fila);
    if (!hito) continue;
    items.push({
      ...hito,
      hora: textoHace(Math.max(0, horasEntre(fila.fechaHora, ahora))),
      fecha: fila.fechaHora.toISOString(),
    });
  }
  return items;
}
