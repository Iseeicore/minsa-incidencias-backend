import {
  ETIQUETA_REFERENCIA_ORIENTATIVA,
  MAXIMO_SUPUESTOS_CITADOS,
  SENALES_QUE_PUEDEN_CITAR_UN_SUPUESTO,
} from "@/constants/normas.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { FaltanteCorrupcion } from "@/enums/filtro-corrupcion.enum.js";
import { GrupoCita, type TemaNorma } from "@/enums/normas.enum.js";
import { DATOS_NORMAS } from "@/services/analisis-ia/normas/fragmentos-normas.data.js";
import {
  MAPA_SENAL_FRAGMENTO,
  type TemaDeNorma,
} from "@/services/analisis-ia/normas/mapa-senal-fragmento.js";
import type {
  CitaNorma,
  DatosNormas,
  FragmentoNorma,
  TrazabilidadNormas,
} from "@/services/analisis-ia/normas/normas.types.js";
import {
  buscarCoincidencias,
  compilarPlantilla,
  crearIndice,
} from "@/services/filtro-corrupcion/coincidencias.js";
import { tokenizar } from "@/services/filtro-corrupcion/normalizar-texto.js";
import type { ResultadoCorrupcion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

const MAXIMO_FRASES_EN_EL_MOTIVO = 3;

const REQUISITO_POR_FALTANTE: Readonly<Record<FaltanteCorrupcion, string>> = {
  [FaltanteCorrupcion.DATOS_INSUFICIENTES]: "AM-REQ-HECHO-DETALLADO",
  [FaltanteCorrupcion.AUTOR_O_CARGO]: "AM-REQ-AUTORES",
  [FaltanteCorrupcion.ENTIDAD]: "AM-REQ-ENTIDAD",
  [FaltanteCorrupcion.PRUEBAS]: "AM-REQ-PRUEBAS",
};

const PROCEDIMIENTO_SI_HAY_CORRUPCION: readonly {
  id: string;
  motivo: string;
}[] = [
  {
    id: "AM-DENUNCIA-CORRUPCION",
    motivo:
      "Se propone corrupción: así define la ayuda memoria una denuncia por acto de corrupción.",
  },
  {
    id: "AM-CRITERIOS-DENUNCIA",
    motivo: "Criterios con los que OTRANS evalúa la denuncia.",
  },
  {
    id: "AM-DERIVA-STPAD-OCI-PP",
    motivo:
      "OTRANS puede derivar a la STPAD, al OCI o a la PP según la temática.",
  },
];

const MOTIVO_FALTANTE =
  "Falta este requisito de la revisión de la denuncia: el texto aún no lo cumple.";

/** Plantillas del mapa compiladas una vez: cada patrón recuerda de qué tema salió. */
interface EntradaDeTema {
  peso: number;
  grupo: string;
  tema: TemaDeNorma;
}
const INDICE_DE_TEMAS = crearIndice(
  MAPA_SENAL_FRAGMENTO.flatMap((tema) =>
    tema.plantillas.flatMap((plantilla) =>
      compilarPlantilla(plantilla).map((patron) => ({
        patron,
        entrada: { peso: 0, grupo: tema.tema, tema } satisfies EntradaDeTema,
      })),
    ),
  ),
);

const PRIORIDAD_DE_TEMA: ReadonlyMap<TemaNorma, number> = new Map(
  MAPA_SENAL_FRAGMENTO.map((tema, i) => [tema.tema, i]),
);

/** Temas que coinciden con las frases de las señales de las reglas, con las frases que los motivan. */
export function temasQueCoinciden(
  reglas: ResultadoCorrupcion,
): { tema: TemaDeNorma; frases: string[] }[] {
  const frasesPorTema = new Map<
    TemaNorma,
    { tema: TemaDeNorma; frases: string[] }
  >();
  for (const senal of reglas.senales) {
    if (!SENALES_QUE_PUEDEN_CITAR_UN_SUPUESTO.includes(senal.tipo)) continue;
    for (const c of buscarCoincidencias(
      tokenizar(senal.frase),
      INDICE_DE_TEMAS,
    )) {
      const registro = frasesPorTema.get(c.entrada.tema.tema) ?? {
        tema: c.entrada.tema,
        frases: [],
      };
      if (!registro.frases.includes(senal.frase))
        registro.frases.push(senal.frase);
      frasesPorTema.set(c.entrada.tema.tema, registro);
    }
  }
  return [...frasesPorTema.values()].sort(
    (a, b) =>
      (PRIORIDAD_DE_TEMA.get(a.tema.tema) ?? 0) -
      (PRIORIDAD_DE_TEMA.get(b.tema.tema) ?? 0),
  );
}

const fragmentoPorId = (
  datos: DatosNormas,
): ReadonlyMap<string, FragmentoNorma> =>
  new Map(datos.fragmentos.map((f) => [f.id, f]));

function citaDe(
  fragmento: FragmentoNorma,
  grupo: GrupoCita,
  motivo: string,
  senalesQueLaMotivan: string[] = [],
): CitaNorma {
  return {
    fragmentoId: fragmento.id,
    fuente: fragmento.fuente,
    referencia: fragmento.referencia,
    titulo: fragmento.titulo,
    tipo: fragmento.tipo,
    texto: fragmento.texto,
    grupo,
    senalesQueLaMotivan,
    motivo,
  };
}

const comillas = (frases: readonly string[]): string =>
  frases
    .slice(0, MAXIMO_FRASES_EN_EL_MOTIVO)
    .map((f) => `«${f}»`)
    .join(", ");

export interface EntradaTrazabilidad {
  reglas: ResultadoCorrupcion;
  /** Categoría que propone el análisis. */
  propuesta: CategoriaIncidencia;
  /** La combinación de reglas y modelo propone corrupción. */
  propuestaCorrupcion: boolean;
}

/**
 * Trazabilidad del análisis con la norma (RAG fase 1). Función pura: la misma entrada da la misma salida y no usa el modelo.
 * - Con corrupción propuesta, cita hasta `MAXIMO_SUPUESTOS_CITADOS` supuestos del Anexo C que se parecen a las señales de las
 *   reglas (o dice que no encontró ninguno), el procedimiento de OTRANS y los requisitos de la revisión que faltan.
 * - Con queja o reclamo, cita la regla de que OTRANS los deriva (y la definición de reclamo).
 * - Nunca cita el cohecho activo (`citaAutomatica: false`).
 * Todo lleva la leyenda «Referencia orientativa; la califica OTRANS.».
 */
export function construirTrazabilidadNormas(
  entrada: EntradaTrazabilidad,
  datos: DatosNormas = DATOS_NORMAS,
): TrazabilidadNormas {
  const porId = fragmentoPorId(datos);
  const supuestos: CitaNorma[] = [];
  const procedimiento: CitaNorma[] = [];
  const yaCitados = new Set<string>();

  const agregar = (
    destino: CitaNorma[],
    id: string,
    grupo: GrupoCita,
    motivo: string,
    senales: string[] = [],
  ): void => {
    const fragmento = porId.get(id);
    if (!fragmento || !fragmento.citaAutomatica || yaCitados.has(id)) return;
    yaCitados.add(id);
    destino.push(citaDe(fragmento, grupo, motivo, senales));
  };

  if (entrada.propuestaCorrupcion) {
    for (const { tema, frases } of temasQueCoinciden(entrada.reglas))
      for (const id of tema.fragmentos) {
        if (supuestos.length >= MAXIMO_SUPUESTOS_CITADOS) break;
        agregar(
          supuestos,
          id,
          GrupoCita.SUPUESTO,
          `Las reglas encontraron ${comillas(frases)} (${tema.descripcion}), que se parece a este supuesto.`,
          frases,
        );
      }
    for (const { id, motivo } of PROCEDIMIENTO_SI_HAY_CORRUPCION)
      agregar(procedimiento, id, GrupoCita.PROCEDIMIENTO, motivo);
    for (const faltante of entrada.reglas.faltantes)
      agregar(
        procedimiento,
        REQUISITO_POR_FALTANTE[faltante],
        GrupoCita.PROCEDIMIENTO,
        MOTIVO_FALTANTE,
      );
  } else if (
    entrada.propuesta === CategoriaIncidencia.QUEJA ||
    entrada.propuesta === CategoriaIncidencia.RECLAMO
  ) {
    agregar(
      procedimiento,
      "AM-DERIVA-QUEJAS-RECLAMOS",
      GrupoCita.PROCEDIMIENTO,
      "No se propone corrupción: según la ayuda memoria, OTRANS deriva las quejas y los reclamos.",
    );
    if (entrada.propuesta === CategoriaIncidencia.RECLAMO)
      agregar(
        procedimiento,
        "AM-DEF-RECLAMO",
        GrupoCita.PROCEDIMIENTO,
        "Así define SUSALUD (DS 002-2019-SA) el reclamo.",
      );
  }

  return {
    version: datos.version,
    etiqueta: ETIQUETA_REFERENCIA_ORIENTATIVA,
    supuestos,
    procedimiento,
    sinSupuestoIdentificado:
      entrada.propuestaCorrupcion && supuestos.length === 0,
    transcripcionAnexoCCotejada: datos.transcripcionAnexoCCotejada,
  };
}
