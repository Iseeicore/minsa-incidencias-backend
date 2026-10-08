import { ESTADOS_ABIERTOS, HORAS_POR_DIA, MILISEGUNDOS_POR_HORA } from "@/constants/incidencias.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { PlazoEstado, PlazoTipo } from "@/enums/plazo.enum.js";

export interface PlazosConfigurados {
  atencionDias: number;
  vigenciaDias: number;
  avisoHoras: number;
}

export interface EntradaDePlazo {
  estado: EstadoIncidencia;
  fechaCreacion: Date;
  /** Última reapertura: el plazo de atención de un caso reabierto cuenta desde aquí y no desde que llegó. */
  reabiertoEn?: Date | null;
  resueltoEn: Date | null;
  ahora: Date;
}

export interface PlazoCalculado {
  tipo: PlazoTipo | null;
  estado: PlazoEstado | null;
  venceEn: string | null;
  horasRestantes: number | null;
}

const SIN_PLAZO: PlazoCalculado = { tipo: null, estado: null, venceEn: null, horasRestantes: null };

export function horasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / MILISEGUNDOS_POR_HORA);
}

const sumarDias = (fecha: Date, dias: number): Date => new Date(fecha.getTime() + dias * HORAS_POR_DIA * MILISEGUNDOS_POR_HORA);

/**
 * Plazo de un caso, calculado con la hora de la base. Un caso abierto tiene el plazo de atención (desde que
 * llega o, si se reabrió, desde su última reapertura) y puede estar en plazo, por vencer (le quedan las horas de aviso o menos) o vencido. Un caso resuelto
 * tiene la vigencia de su resolución (desde que se resuelve): en plazo o vencido, a la espera del archivado.
 * Un caso archivado no tiene plazo.
 */
export function calcularPlazo(entrada: EntradaDePlazo, plazos: PlazosConfigurados): PlazoCalculado {
  const { estado, fechaCreacion, reabiertoEn, resueltoEn, ahora } = entrada;

  if (ESTADOS_ABIERTOS.includes(estado)) {
    const venceEn = sumarDias(reabiertoEn ?? fechaCreacion, plazos.atencionDias);
    const horasRestantes = horasEntre(ahora, venceEn);
    let estadoDelPlazo: PlazoEstado = PlazoEstado.EN_PLAZO;
    if (venceEn.getTime() <= ahora.getTime()) estadoDelPlazo = PlazoEstado.VENCIDO;
    else if (horasRestantes <= plazos.avisoHoras) estadoDelPlazo = PlazoEstado.POR_VENCER;
    return { tipo: PlazoTipo.ATENCION, estado: estadoDelPlazo, venceEn: venceEn.toISOString(), horasRestantes };
  }

  if (estado === EstadoIncidencia.RESUELTO && resueltoEn) {
    const venceEn = sumarDias(resueltoEn, plazos.vigenciaDias);
    return {
      tipo: PlazoTipo.VIGENCIA,
      estado: venceEn.getTime() <= ahora.getTime() ? PlazoEstado.VENCIDO : PlazoEstado.EN_PLAZO,
      venceEn: venceEn.toISOString(),
      horasRestantes: horasEntre(ahora, venceEn),
    };
  }

  return SIN_PLAZO;
}
