import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";

/** De dónde sale el ejemplo. Nunca de `desarrollo` ni de `prueba-t1`: inflaría las cifras (plan de PoC, sección 10). */
export const OrigenEjemplo = {
  /** Fila de la tabla de casos límite del léxico (sección 8 de «Léxico de corrupción»). */
  LEXICO: "LEXICO",
  /** Escrito para este prompt, sin copiar de ningún conjunto de mensajes. */
  INVENTADO: "INVENTADO",
} as const;
export type OrigenEjemplo = (typeof OrigenEjemplo)[keyof typeof OrigenEjemplo];

export interface EjemploResuelto {
  texto: string;
  categoria: CategoriaIncidencia;
  /** Peso de 0 a 10, con las anclas del prompt. */
  peso: number;
  posibleCorrupcion: boolean;
  origen: OrigenEjemplo;
}

const { DENUNCIA_CORRUPCION, QUEJA, RECLAMO, OTRO } = CategoriaIncidencia;
const { LEXICO, INVENTADO } = OrigenEjemplo;

/**
 * Ejemplos de la variante V3: seis de corrupción, cuatro de queja, cuatro de reclamo y dos de otro. Incluyen pagos con boleta (que
 * no son corrupción) y quejas o reclamos que usan la palabra «denuncia» (que tampoco lo son). El orden mezcla las categorías.
 */
export const EJEMPLOS_RESUELTOS: readonly EjemploResuelto[] = [
  {
    texto: "El director no me quiso atender",
    categoria: QUEJA,
    peso: 0,
    posibleCorrupcion: false,
    origen: LEXICO,
  },
  {
    texto: "Me cobraron 50 soles sin recibo para darme la cita",
    categoria: DENUNCIA_CORRUPCION,
    peso: 6,
    posibleCorrupcion: true,
    origen: LEXICO,
  },
  {
    texto: "Pagué 20 soles en caja y me dieron boleta",
    categoria: RECLAMO,
    peso: 0,
    posibleCorrupcion: false,
    origen: LEXICO,
  },
  {
    texto: "No hay medicinas en la farmacia",
    categoria: RECLAMO,
    peso: 0,
    posibleCorrupcion: false,
    origen: LEXICO,
  },
  {
    texto: "La enfermera vende las medicinas del SIS",
    categoria: DENUNCIA_CORRUPCION,
    peso: 8,
    posibleCorrupcion: true,
    origen: LEXICO,
  },
  {
    texto: "Mi médico me derivó a su clínica particular",
    categoria: DENUNCIA_CORRUPCION,
    peso: 4,
    posibleCorrupcion: true,
    origen: LEXICO,
  },
  {
    texto: "Contrataron a la sobrina del director",
    categoria: DENUNCIA_CORRUPCION,
    peso: 7,
    posibleCorrupcion: true,
    origen: LEXICO,
  },
  {
    texto: "Me robaron el celular en emergencia",
    categoria: OTRO,
    peso: 0,
    posibleCorrupcion: false,
    origen: LEXICO,
  },
  {
    texto: "Quiero denunciar el mal trato",
    categoria: QUEJA,
    peso: 0,
    posibleCorrupcion: false,
    origen: LEXICO,
  },
  {
    texto: "El jefe de logística favoreció a una empresa",
    categoria: DENUNCIA_CORRUPCION,
    peso: 7,
    posibleCorrupcion: true,
    origen: LEXICO,
  },
  {
    texto:
      "La técnica pasó todo el turno hablando por celular mientras los pacientes esperábamos y se rio cuando le reclamé",
    categoria: QUEJA,
    peso: 0,
    posibleCorrupcion: false,
    origen: INVENTADO,
  },
  {
    texto:
      "Denuncio que la doctora me gritó delante de todos y no me dejó explicar mis síntomas",
    categoria: QUEJA,
    peso: 0,
    posibleCorrupcion: false,
    origen: INVENTADO,
  },
  {
    texto:
      "Quiero poner una denuncia porque la cita con el cardiólogo me la dieron para dentro de tres meses",
    categoria: RECLAMO,
    peso: 0,
    posibleCorrupcion: false,
    origen: INVENTADO,
  },
  {
    texto:
      "Para recoger mi historia clínica el señor de archivo me pidió 30 soles aparte y no me dio recibo",
    categoria: DENUNCIA_CORRUPCION,
    peso: 6,
    posibleCorrupcion: true,
    origen: INVENTADO,
  },
  {
    texto:
      "Mi mamá tuvo cita confirmada a las 8 y la atendieron a las 2 de la tarde sin darle ninguna explicación",
    categoria: RECLAMO,
    peso: 0,
    posibleCorrupcion: false,
    origen: INVENTADO,
  },
  {
    texto:
      "Pagué 15 soles en la caja por mi análisis, tengo mi boleta, solo quiero saber si ese es el precio oficial",
    categoria: OTRO,
    peso: 0,
    posibleCorrupcion: false,
    origen: INVENTADO,
  },
];
