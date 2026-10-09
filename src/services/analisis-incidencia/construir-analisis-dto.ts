import { z } from "zod";
import { ETIQUETA_REFERENCIA_ORIENTATIVA } from "@/constants/normas.js";
import { CATEGORIA_API } from "@/constants/incidencias.js";
import { InformacionFaltanteIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { MotivoDeEscritura } from "@/enums/clasificador.enum.js";
import { GrupoCita } from "@/enums/normas.enum.js";
import { DATOS_NORMAS } from "@/services/analisis-ia/normas/fragmentos-normas.data.js";
import type { DatosNormas } from "@/services/analisis-ia/normas/normas.types.js";
import type { FilaAnalisis } from "@/repositories/analisis-incidencia.repository.js";
import type {
  AnalisisIaDto,
  CitaNormaDto,
  RequisitoFaltanteDto,
} from "@/services/analisis-incidencia/analisis-incidencia.types.js";
import type { ReferenciaDerivacion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

/** Requisito de la revisión de la denuncia (ayuda memoria de OTRANS) que corresponde a cada dato que falta. */
export const REQUISITO_POR_INFORMACION_FALTANTE: Readonly<
  Record<InformacionFaltanteIa, string>
> = {
  [InformacionFaltanteIa.HECHO_DETALLADO]: "AM-REQ-HECHO-DETALLADO",
  [InformacionFaltanteIa.AUTOR_O_CARGO]: "AM-REQ-AUTORES",
  [InformacionFaltanteIa.ENTIDAD_O_UNIDAD]: "AM-REQ-ENTIDAD",
  [InformacionFaltanteIa.PRUEBAS]: "AM-REQ-PRUEBAS",
};

const categoriaIncidencia = z.enum(
  Object.values(CategoriaIncidencia) as [
    CategoriaIncidencia,
    ...CategoriaIncidencia[],
  ],
);

/**
 * Forma esperada del jsonb que escribe el clasificador (`SenalesGuardadas`). Es tolerante a propósito: un análisis escrito por otro
 * proceso, o por una versión anterior, se muestra con lo que traiga y no rompe la lectura.
 */
const esquemaSenales = z.object({
  senales: z
    .array(z.object({ frase: z.string(), tipo: z.string(), peso: z.number() }))
    .catch([]),
  explicacion: z.string().nullable().catch(null),
  informacionFaltante: z
    .array(
      z.enum(
        Object.values(InformacionFaltanteIa) as [
          InformacionFaltanteIa,
          ...InformacionFaltanteIa[],
        ],
      ),
    )
    .catch([]),
  fichaDerivacion: z
    .custom<ReferenciaDerivacion | null>()
    .nullable()
    .catch(null),
  normas: z
    .object({
      version: z.string(),
      etiqueta: z.string().optional(),
      transcripcionAnexoCCotejada: z.boolean().catch(false),
      sinSupuestoIdentificado: z.boolean().catch(false),
      citas: z
        .array(
          z.object({
            fragmentoId: z.string(),
            referencia: z.string(),
            grupo: z.enum([GrupoCita.SUPUESTO, GrupoCita.PROCEDIMIENTO]),
            senalesQueLaMotivan: z.array(z.string()).catch([]),
          }),
        )
        .catch([]),
    })
    .nullable()
    .catch(null),
  decision: z
    .object({
      motivo: z
        .enum(
          Object.values(MotivoDeEscritura) as [
            MotivoDeEscritura,
            ...MotivoDeEscritura[],
          ],
        )
        .catch(MotivoDeEscritura.SIN_CORRUPCION),
      propuestaDelAnalisis: categoriaIncidencia.nullable().catch(null),
      escalarAOtrans: z.boolean().catch(false),
      requiereRevisionHumana: z.boolean().catch(false),
      pesoIa: z.number().nullable().catch(null),
    })
    .nullable()
    .catch(null),
  modelo: z
    .object({
      variante: z
        .enum(Object.values(VarianteIa) as [VarianteIa, ...VarianteIa[]])
        .nullable()
        .catch(null),
      degradado: z.boolean().catch(false),
    })
    .nullable()
    .catch(null),
});

/**
 * El análisis de un caso tal como lo ven OTRANS y el administrador: lo guardado más el texto literal de cada cita, que se recupera de
 * la versión de normas (la fila guarda solo ids y referencias). Función pura.
 */
export function construirAnalisisDto(
  codigo: string,
  fila: FilaAnalisis,
  normas: DatosNormas = DATOS_NORMAS,
): AnalisisIaDto {
  const crudo: unknown =
    typeof fila.senales === "object" &&
    fila.senales !== null &&
    !Array.isArray(fila.senales)
      ? fila.senales
      : {};
  // Lo que no cumple la forma esperada se lee como vacío: un análisis raro nunca rompe la lectura.
  const guardado =
    esquemaSenales.safeParse(crudo).data ?? esquemaSenales.parse({});
  const porId = new Map(normas.fragmentos.map((f) => [f.id, f]));
  const cita = (
    c: NonNullable<typeof guardado.normas>["citas"][number],
  ): CitaNormaDto => {
    const fragmento = porId.get(c.fragmentoId);
    return {
      fragmentoId: c.fragmentoId,
      grupo: c.grupo,
      referencia: fragmento?.referencia ?? c.referencia,
      titulo: fragmento?.titulo ?? c.referencia,
      texto: fragmento?.texto ?? null,
      senalesQueLaMotivan: c.senalesQueLaMotivan,
    };
  };
  const citas = (guardado.normas?.citas ?? []).map(cita);
  const requisitos: RequisitoFaltanteDto[] =
    guardado.informacionFaltante.flatMap((codigoFaltante) => {
      const fragmento = porId.get(
        REQUISITO_POR_INFORMACION_FALTANTE[codigoFaltante],
      );
      return fragmento
        ? [
            {
              codigo: codigoFaltante,
              referencia: fragmento.referencia,
              texto: fragmento.texto,
            },
          ]
        : [];
    });
  const propuesta = guardado.decision?.propuestaDelAnalisis ?? null;
  return {
    codigo,
    categoriaIa: fila.categoriaIa ? CATEGORIA_API[fila.categoriaIa] : null,
    confianzaIa: fila.confianzaIa,
    versionClasificador: fila.versionClasificador,
    versionReglas: fila.versionReglas,
    puntaje: fila.puntaje,
    motivoDeEscritura: guardado.decision?.motivo ?? null,
    propuestaDelAnalisis: propuesta ? CATEGORIA_API[propuesta] : null,
    requiereRevisionHumana: guardado.decision?.requiereRevisionHumana ?? false,
    escalarAOtrans: guardado.decision?.escalarAOtrans ?? false,
    explicacion: guardado.explicacion,
    senales: guardado.senales,
    supuestos: citas.filter((c) => c.grupo === GrupoCita.SUPUESTO),
    procedimiento: citas.filter((c) => c.grupo === GrupoCita.PROCEDIMIENTO),
    sinSupuestoIdentificado: guardado.normas?.sinSupuestoIdentificado ?? false,
    etiquetaNormas: ETIQUETA_REFERENCIA_ORIENTATIVA,
    versionNormas: guardado.normas?.version ?? null,
    transcripcionAnexoCCotejada:
      guardado.normas?.transcripcionAnexoCCotejada ?? false,
    requisitosFaltantes: requisitos,
    fichaDerivacion: guardado.fichaDerivacion,
    cargoMencionado: fila.cargoMencionado,
    nombreMencionado: fila.nombreMencionado,
    areaMencionada:
      fila.areaMencionadaCodigo && fila.areaMencionadaNombre
        ? {
            codigo: fila.areaMencionadaCodigo,
            nombre: fila.areaMencionadaNombre,
          }
        : null,
    modelo: {
      variante: guardado.modelo?.variante ?? null,
      degradado: guardado.modelo?.degradado ?? false,
      pesoIa: guardado.decision?.pesoIa ?? null,
    },
    fechaAnalisis: fila.fechaAnalisis.toISOString(),
  };
}
