import type { Database, DbExecutor } from "@/database/database.js";
import type { TipoArea } from "@/enums/tipo-area.enum.js";
import type { PosicionDeAreas } from "@/utils/cursor-areas.js";
import { escaparComodines } from "@/utils/texto-busqueda.js";

export interface FiltrosDeAreas {
  tipo?: TipoArea;
  texto?: string;
  /** Si se indica, solo esa área; `null` si la persona no tiene ninguna (entonces no ve ninguna). Ausente: todas. */
  soloAreaId?: number | null;
}

export interface FilaArea {
  id: number;
  codigo: string;
  nombre: string;
  tipoArea: TipoArea;
  codigoRenipress: string | null;
  nivelAtencion: string | null;
  categoria: string | null;
}

export class AreaRepository {
  constructor(private readonly database: Database) {}

  /**
   * Áreas activas (de un tipo de área activo), ordenadas por nombre e id. Paginación por cursor: desde justo después de
   * la posición dada; quien llama pide una más que el límite para saber si quedan. La búsqueda es sin tildes ni
   * mayúsculas sobre el nombre: usa `nombre_busqueda` (columna generada) en los establecimientos y `f_unaccent` en
   * las demás áreas. Nada del usuario se pega en el SQL.
   */
  async listar(
    filtros: FiltrosDeAreas,
    limite: number,
    despuesDe: PosicionDeAreas | null,
    ejecutor: DbExecutor = this.database,
  ): Promise<FilaArea[]> {
    const valores: unknown[] = [];
    const marcador = (valor: unknown): string => {
      valores.push(valor);
      return `$${valores.length}`;
    };
    const condiciones = ["a.activo", "ta.activo"];
    if (filtros.soloAreaId !== undefined) condiciones.push(`a.id = ${marcador(filtros.soloAreaId)}::int`);
    if (filtros.tipo) condiciones.push(`ta.codigo = ${marcador(filtros.tipo)}`);
    if (filtros.texto) {
      const patron = marcador(`%${escaparComodines(filtros.texto)}%`);
      condiciones.push(`COALESCE(es.nombre_busqueda, public.f_unaccent(a.nombre)) LIKE public.f_unaccent(${patron}) ESCAPE '\\'`);
    }
    if (despuesDe) condiciones.push(`(a.nombre, a.id) > (${marcador(despuesDe.nombre)}::text, ${marcador(despuesDe.id)}::int)`);

    return ejecutor.query<FilaArea>(
      `SELECT a.id,
              a.codigo,
              a.nombre,
              ta.codigo AS "tipoArea",
              es.codigo_renipress AS "codigoRenipress",
              na.codigo AS "nivelAtencion",
              es.categoria
         FROM catalogo.area a
         JOIN catalogo.tipo_area ta ON ta.id = a.tipo_area_id
         LEFT JOIN catalogo.establecimiento_salud es ON es.area_id = a.id
         LEFT JOIN catalogo.nivel_atencion na ON na.id = es.nivel_atencion_id
        WHERE ${condiciones.join(" AND ")}
        ORDER BY a.nombre, a.id
        LIMIT ${marcador(limite)}`,
      valores,
    );
  }
}
