import type { InformacionFaltanteIa } from "@/enums/analisis-ia.enum.js";
import type { GrupoCita } from "@/enums/normas.enum.js";
import type { PaqueteAnalisis } from "@/services/analisis-ia/analisis-ia.types.js";
import type {
  ReferenciaDerivacion,
  SenalDetectada,
} from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

/** Una cita guardada: el id y la referencia bastan; el texto literal se recupera de la versión de normas. */
export interface CitaNormaGuardada {
  fragmentoId: string;
  referencia: string;
  grupo: GrupoCita;
  senalesQueLaMotivan: string[];
}

/**
 * Contenido del campo jsonb `chatbot.incidencia_analisis.senales` mientras la ficha, los faltantes y las normas no tengan tabla
 * propia (plan de PoC, sección 2). Solo se define la forma: hoy nada escribe en esa tabla (el bot no la usa todavía).
 */
export interface SenalesDeAnalisis {
  senales: SenalDetectada[];
  faltantes: InformacionFaltanteIa[];
  fichaDerivacion: ReferenciaDerivacion | null;
  normas: {
    version: string;
    /** «Referencia orientativa; la califica OTRANS.». */
    etiqueta: string;
    transcripcionAnexoCCotejada: boolean;
    sinSupuestoIdentificado: boolean;
    citas: CitaNormaGuardada[];
  };
}

/** Arma lo que iría en `incidencia_analisis.senales` desde el paquete. Función pura; no incluye el texto del ciudadano ni el de las normas. */
export function construirSenalesDeAnalisis(
  paquete: PaqueteAnalisis,
): SenalesDeAnalisis {
  const { trazabilidadNormas } = paquete;
  return {
    senales: paquete.reglas.senales,
    faltantes: paquete.informacionFaltante,
    fichaDerivacion: paquete.fichaDerivacion,
    normas: {
      version: trazabilidadNormas.version,
      etiqueta: trazabilidadNormas.etiqueta,
      transcripcionAnexoCCotejada:
        trazabilidadNormas.transcripcionAnexoCCotejada,
      sinSupuestoIdentificado: trazabilidadNormas.sinSupuestoIdentificado,
      citas: [
        ...trazabilidadNormas.supuestos,
        ...trazabilidadNormas.procedimiento,
      ].map((c) => ({
        fragmentoId: c.fragmentoId,
        referencia: c.referencia,
        grupo: c.grupo,
        senalesQueLaMotivan: c.senalesQueLaMotivan,
      })),
    },
  };
}
