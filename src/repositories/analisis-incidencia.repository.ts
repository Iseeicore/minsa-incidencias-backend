import type { Database, DbExecutor } from "@/database/database.js";
import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";

export interface FilaAnalisis {
  versionReglas: string;
  puntaje: number;
  /** El jsonb tal cual lo guardó el clasificador; se valida al armar el DTO. */
  senales: unknown;
  cargoMencionado: string | null;
  nombreMencionado: string | null;
  areaMencionadaCodigo: string | null;
  areaMencionadaNombre: string | null;
  categoriaIa: CategoriaIncidencia | null;
  confianzaIa: number | null;
  versionClasificador: string | null;
  fechaAnalisis: Date;
}

/** Solo lectura de `chatbot.incidencia_analisis` (una fila por incidencia, de solo inserción). */
export class AnalisisIncidenciaRepository {
  constructor(private readonly database: Database) {}

  async buscar(
    incidenciaId: string,
    ejecutor: DbExecutor = this.database,
  ): Promise<FilaAnalisis | null> {
    const filas = await ejecutor.query<FilaAnalisis>(
      `SELECT a.version_reglas AS "versionReglas",
              a.puntaje::int AS puntaje,
              a.senales AS senales,
              a.cargo_mencionado AS "cargoMencionado",
              a.nombre_mencionado AS "nombreMencionado",
              ar.codigo AS "areaMencionadaCodigo",
              ar.nombre AS "areaMencionadaNombre",
              cia.codigo AS "categoriaIa",
              i.categoria_confianza::float8 AS "confianzaIa",
              i.version_clasificador AS "versionClasificador",
              a.fecha_creacion AS "fechaAnalisis"
         FROM chatbot.incidencia_analisis a
         JOIN chatbot.incidencia_paciente i ON i.id = a.incidencia_paciente_id
         LEFT JOIN catalogo.area ar ON ar.id = a.area_mencionada_id
         LEFT JOIN catalogo.categoria_incidencia cia ON cia.id = i.categoria_ia_id
        WHERE a.incidencia_paciente_id = $1`,
      [incidenciaId],
    );
    return filas[0] ?? null;
  }
}
