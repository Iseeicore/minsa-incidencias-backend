import type { Database } from "@/database/database.js";
import type { TipoArea } from "@/enums/tipo-area.enum.js";
import type { AreaDeSesion } from "@/services/auth.types.js";

export interface SesionConUsuario {
  sesionId: string;
  usuarioId: string;
  correo: string;
  nombreCompleto: string;
  roles: string[];
  area: AreaDeSesion | null;
  debeTocar: boolean;
}

interface FilaDeSesion extends Omit<SesionConUsuario, "area"> {
  areaId: number | null;
  areaCodigo: string | null;
  areaNombre: string | null;
  areaTipo: TipoArea | null;
}

export class SesionRepository {
  constructor(private readonly database: Database) {}

  async crear(actor: string, usuarioId: string, horasAbsolutas: number): Promise<string> {
    return this.database.transaction(actor, async (tx) => {
      const filas = await tx.query<{ id: string }>(
        `INSERT INTO gestion.sesion_usuario (usuario_interno_id, vence_en)
         VALUES ($1, now() + make_interval(hours => $2))
         RETURNING id`,
        [usuarioId, horasAbsolutas],
      );
      return (filas[0] as { id: string }).id;
    });
  }

  /**
   * Devuelve la sesión solo si sigue abierta (no revocada, dentro de su vigencia absoluta y de la
   * inactividad permitida) y su usuario está activo, junto con los roles activos del usuario y su área. Todo
   * en una consulta y con el reloj de la base. Un rol desactivado no cuenta.
   */
  async buscarVigente(
    sesionId: string,
    minutosInactividad: number,
    segundosParaTocar: number,
  ): Promise<SesionConUsuario | null> {
    const filas = await this.database.query<FilaDeSesion>(
      `SELECT s.id AS "sesionId",
              u.id AS "usuarioId",
              u.correo,
              u.nombre_completo AS "nombreCompleto",
              ARRAY(
                SELECT DISTINCT r.codigo
                  FROM gestion.usuario_rol ur
                  JOIN gestion.rol r ON r.id = ur.rol_id AND r.activo
                 WHERE ur.usuario_interno_id = u.id
                 ORDER BY r.codigo
              ) AS roles,
              a.id AS "areaId",
              a.codigo AS "areaCodigo",
              a.nombre AS "areaNombre",
              ta.codigo AS "areaTipo",
              (now() - s.ultima_actividad_en) > make_interval(secs => $3) AS "debeTocar"
         FROM gestion.sesion_usuario s
         JOIN gestion.usuario_interno u ON u.id = s.usuario_interno_id
         LEFT JOIN catalogo.area a ON a.id = u.area_id
         LEFT JOIN catalogo.tipo_area ta ON ta.id = a.tipo_area_id
        WHERE s.id = $1
          AND s.revocada_en IS NULL
          AND s.vence_en > now()
          AND s.ultima_actividad_en > now() - make_interval(mins => $2)
          AND u.activo`,
      [sesionId, minutosInactividad, segundosParaTocar],
    );
    const fila = filas[0];
    if (!fila) return null;
    const { areaId, areaCodigo, areaNombre, areaTipo, ...sesion } = fila;
    const area =
      areaId !== null && areaCodigo !== null && areaNombre !== null && areaTipo !== null
        ? { id: areaId, codigo: areaCodigo, nombre: areaNombre, tipo: areaTipo }
        : null;
    return { ...sesion, area };
  }

  async tocarActividad(actor: string, sesionId: string): Promise<void> {
    await this.database.transaction(actor, async (tx) => {
      await tx.query(
        `UPDATE gestion.sesion_usuario SET ultima_actividad_en = now() WHERE id = $1 AND revocada_en IS NULL`,
        [sesionId],
      );
    });
  }

  async revocar(actor: string, sesionId: string): Promise<void> {
    await this.database.transaction(actor, async (tx) => {
      await tx.query(
        `UPDATE gestion.sesion_usuario SET revocada_en = now() WHERE id = $1 AND revocada_en IS NULL`,
        [sesionId],
      );
    });
  }
}
