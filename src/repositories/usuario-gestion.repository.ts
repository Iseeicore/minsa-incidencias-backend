import type { RolVigente } from "@/constants/permisos-por-rol.js";
import type { Database, DbExecutor } from "@/database/database.js";
import type { PosicionDeUsuarios } from "@/utils/cursor-usuarios.js";
import { escaparComodines } from "@/utils/texto-busqueda.js";

export interface FiltrosDeUsuarios {
  texto?: string;
  /** Código del área. */
  areaCodigo?: string;
  /** Si se indica, solo los de esa área; `null` si quien consulta no tiene ninguna (entonces no ve ninguno). Ausente: todas. */
  soloAreaId?: number | null;
}

export interface FilaUsuarioGestion {
  id: string;
  nombreCompleto: string;
  correo: string;
  activo: boolean;
  rol: string | null;
  areaId: number | null;
  areaCodigo: string | null;
  areaNombre: string | null;
}

export interface DatosNuevoUsuarioFila {
  nombreCompleto: string;
  correo: string;
  huella: string;
  areaId: number | null;
}

/** Acceso a los usuarios internos para gestionarlos. El login usa `UsuarioRepository`, que no cambia. Nada del usuario se pega en el SQL. */
export class UsuarioGestionRepository {
  constructor(private readonly database: Database) {}

  /**
   * Usuarios ordenados por nombre e id, con paginación por cursor: desde justo después de la posición dada; quien llama
   * pide uno más que el límite para saber si quedan. La búsqueda es sin tildes ni mayúsculas sobre el nombre y el correo.
   */
  async listar(
    filtros: FiltrosDeUsuarios,
    limite: number,
    despuesDe: PosicionDeUsuarios | null,
    ejecutor: DbExecutor = this.database,
  ): Promise<FilaUsuarioGestion[]> {
    const valores: unknown[] = [];
    const marcador = (valor: unknown): string => {
      valores.push(valor);
      return `$${valores.length}`;
    };
    const condiciones: string[] = [];
    if (filtros.soloAreaId !== undefined) condiciones.push(`u.area_id = ${marcador(filtros.soloAreaId)}::int`);
    if (filtros.areaCodigo) condiciones.push(`a.codigo = ${marcador(filtros.areaCodigo)}`);
    if (filtros.texto) {
      const patron = marcador(`%${escaparComodines(filtros.texto)}%`);
      condiciones.push(
        `(public.f_unaccent(lower(u.nombre_completo)) LIKE public.f_unaccent(lower(${patron})) ESCAPE '\\' OR u.correo LIKE lower(${patron}) ESCAPE '\\')`,
      );
    }
    if (despuesDe) condiciones.push(`(u.nombre_completo, u.id) > (${marcador(despuesDe.nombre)}::text, ${marcador(despuesDe.id)}::uuid)`);

    return ejecutor.query<FilaUsuarioGestion>(
      `${SELECT_USUARIO}
        ${condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : ""}
        ORDER BY u.nombre_completo, u.id
        LIMIT ${marcador(limite)}`,
      valores,
    );
  }

  /** Un usuario por su id dentro del alcance de quien consulta; fuera de él es como si no existiera. `bloquear` toma la fila (`FOR UPDATE`). */
  async buscarPorId(
    id: string,
    soloAreaId: number | null | undefined,
    ejecutor: DbExecutor = this.database,
    bloquear = false,
  ): Promise<FilaUsuarioGestion | null> {
    const valores: unknown[] = [id];
    let alcance = "";
    if (soloAreaId !== undefined) {
      valores.push(soloAreaId);
      alcance = "AND u.area_id = $2::int";
    }
    const filas = await ejecutor.query<FilaUsuarioGestion>(
      `${SELECT_USUARIO} WHERE u.id = $1 ${alcance} ${bloquear ? "FOR UPDATE OF u" : ""}`,
      valores,
    );
    return filas[0] ?? null;
  }

  /** El área activa con ese código, o `null`. */
  async areaActiva(codigo: string, ejecutor: DbExecutor = this.database): Promise<number | null> {
    const filas = await ejecutor.query<{ id: number }>("SELECT id FROM catalogo.area WHERE codigo = $1 AND activo", [codigo]);
    return filas[0]?.id ?? null;
  }

  async crear(tx: DbExecutor, datos: DatosNuevoUsuarioFila): Promise<string> {
    const filas = await tx.query<{ id: string }>(
      `INSERT INTO gestion.usuario_interno (nombre_completo, correo, password_hash, area_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [datos.nombreCompleto, datos.correo, datos.huella, datos.areaId],
    );
    return (filas[0] as { id: string }).id;
  }

  async asignarRol(tx: DbExecutor, usuarioId: string, rol: RolVigente): Promise<void> {
    await tx.query("INSERT INTO gestion.usuario_rol (usuario_interno_id, rol_id) SELECT $1, id FROM gestion.rol WHERE codigo = $2", [
      usuarioId,
      rol,
    ]);
  }

  async quitarRoles(tx: DbExecutor, usuarioId: string): Promise<void> {
    await tx.query("DELETE FROM gestion.usuario_rol WHERE usuario_interno_id = $1", [usuarioId]);
  }

  /** Mover de área cierra las sesiones del usuario: lo hace un disparador de la base. */
  async cambiarArea(tx: DbExecutor, usuarioId: string, areaId: number | null): Promise<void> {
    await tx.query("UPDATE gestion.usuario_interno SET area_id = $2 WHERE id = $1", [usuarioId, areaId]);
  }

  async cambiarNombre(tx: DbExecutor, usuarioId: string, nombreCompleto: string): Promise<void> {
    await tx.query("UPDATE gestion.usuario_interno SET nombre_completo = $2 WHERE id = $1", [usuarioId, nombreCompleto]);
  }

  /**
   * Desactivar nunca borra: marca `activo = false` con quién y cuándo (la base lo exige junto) y un disparador cierra
   * sus sesiones. Reactivar limpia esas marcas.
   */
  async cambiarVigencia(tx: DbExecutor, usuarioId: string, activo: boolean, actor: string): Promise<void> {
    await tx.query(
      `UPDATE gestion.usuario_interno
          SET activo = $2,
              eliminado_en = CASE WHEN $2::boolean THEN NULL ELSE now() END,
              eliminado_por = CASE WHEN $2::boolean THEN NULL ELSE $3::text END
        WHERE id = $1`,
      [usuarioId, activo, actor],
    );
  }

  async cambiarClave(tx: DbExecutor, usuarioId: string, huella: string): Promise<void> {
    await tx.query("UPDATE gestion.usuario_interno SET password_hash = $2 WHERE id = $1", [usuarioId, huella]);
  }

  /** Cierra todas las sesiones abiertas del usuario (al cambiarle el rol o la clave; desactivar y mover de área ya lo hace un disparador). */
  async cerrarSesiones(tx: DbExecutor, usuarioId: string): Promise<void> {
    await tx.query("UPDATE gestion.sesion_usuario SET revocada_en = now() WHERE usuario_interno_id = $1 AND revocada_en IS NULL", [usuarioId]);
  }
}

const SELECT_USUARIO = `
  SELECT u.id,
         u.nombre_completo AS "nombreCompleto",
         u.correo,
         u.activo,
         (SELECT r.codigo
            FROM gestion.usuario_rol ur
            JOIN gestion.rol r ON r.id = ur.rol_id AND r.activo
           WHERE ur.usuario_interno_id = u.id
           ORDER BY r.codigo
           LIMIT 1) AS rol,
         u.area_id AS "areaId",
         a.codigo AS "areaCodigo",
         a.nombre AS "areaNombre"
    FROM gestion.usuario_interno u
    LEFT JOIN catalogo.area a ON a.id = u.area_id`;
