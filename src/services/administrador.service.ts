import { ACTOR_SISTEMA_CREAR_ADMIN } from "@/database/actor.js";
import type { Database } from "@/database/database.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import type { PasswordHasher } from "@/utils/password-hasher.js";
import { normalizarCorreo } from "./auth.service.js";

const UNIQUE_VIOLATION = "23505";

export interface DatosAdministrador {
  nombreCompleto: string;
  correo: string;
  password: string;
}

export async function crearAdministrador(
  database: Database,
  hasher: PasswordHasher,
  datos: DatosAdministrador,
): Promise<void> {
  const huella = await hasher.hash(datos.password);
  try {
    await database.transaction(ACTOR_SISTEMA_CREAR_ADMIN, async (tx) => {
      const filas = await tx.query<{ id: string }>(
        `INSERT INTO gestion.usuario_interno (nombre_completo, correo, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [datos.nombreCompleto, normalizarCorreo(datos.correo), huella],
      );
      await tx.query(
        `INSERT INTO gestion.usuario_rol (usuario_interno_id, rol_id)
         SELECT $1, id FROM gestion.rol WHERE codigo = $2`,
        [(filas[0] as { id: string }).id, RolCodigo.ADMINISTRADOR],
      );
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new AppError(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "Ya existe un usuario con ese correo.");
    }
    throw error;
  }
}
