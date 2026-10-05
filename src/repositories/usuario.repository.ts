import type { Database } from "@/database/database.js";

export interface UsuarioInterno {
  id: string;
  correo: string;
  nombreCompleto: string;
  passwordHash: string;
  activo: boolean;
}

export class UsuarioRepository {
  constructor(private readonly database: Database) {}

  async buscarPorCorreo(correo: string): Promise<UsuarioInterno | null> {
    const filas = await this.database.query<UsuarioInterno>(
      `SELECT id, correo, nombre_completo AS "nombreCompleto", password_hash AS "passwordHash", activo
         FROM gestion.usuario_interno
        WHERE correo = $1`,
      [correo],
    );
    return filas[0] ?? null;
  }
}
