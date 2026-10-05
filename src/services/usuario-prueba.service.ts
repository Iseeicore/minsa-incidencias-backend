import { z } from "zod";
import { MIN_ADMIN_PASSWORD_LENGTH } from "@/constants/limits.js";
import { PERMISOS_POR_ROL, type RolVigente } from "@/constants/permisos-por-rol.js";
import { ACTOR_SISTEMA_USUARIO_PRUEBA } from "@/database/actor.js";
import { assertBaseDesechable } from "@/database/base-desechable.js";
import type { Database } from "@/database/database.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";
import type { PasswordHasher } from "@/utils/password-hasher.js";
import { normalizarCorreo } from "./auth.service.js";

const UNIQUE_VIOLATION = "23505";

const ROLES_VIGENTES = Object.keys(PERMISOS_POR_ROL) as [RolVigente, ...RolVigente[]];

const entornoSchema = z.object({
  USUARIO_NOMBRE: z.string().trim().min(1),
  USUARIO_CORREO: z.email(),
  USUARIO_PASSWORD: z.string().min(MIN_ADMIN_PASSWORD_LENGTH),
  USUARIO_ROL: z.enum(ROLES_VIGENTES),
  USUARIO_AREA: z.string().trim().min(1).optional(),
  DATABASE_URL: z.string().min(1),
});

export const ResultadoUsuarioPrueba = {
  CREADO: "creado",
  EXISTENTE: "existente",
} as const;
export type ResultadoUsuarioPrueba = (typeof ResultadoUsuarioPrueba)[keyof typeof ResultadoUsuarioPrueba];

export interface DatosUsuarioPrueba {
  nombreCompleto: string;
  correo: string;
  password: string;
  rol: RolVigente;
  /** Código del área (catalogo.area). Sin ella la persona no ve casos de un establecimiento. */
  areaCodigo?: string;
}

/**
 * Valida las variables del script y se niega a seguir si la base no es desechable. Va antes de abrir cualquier
 * conexión y nunca imprime la URL ni la clave.
 */
export function leerDatosUsuarioPrueba(source: NodeJS.ProcessEnv): DatosUsuarioPrueba {
  const entorno = entornoSchema.parse(source);
  assertBaseDesechable(entorno.DATABASE_URL);
  return {
    nombreCompleto: entorno.USUARIO_NOMBRE,
    correo: entorno.USUARIO_CORREO,
    password: entorno.USUARIO_PASSWORD,
    rol: entorno.USUARIO_ROL,
    ...(entorno.USUARIO_AREA ? { areaCodigo: entorno.USUARIO_AREA } : {}),
  };
}

/**
 * Crea una persona sintética con un rol vigente. Si el correo ya existe no toca nada: ni duplica, ni cambia la
 * clave, ni agrega roles.
 */
export async function crearUsuarioDePrueba(
  database: Database,
  hasher: PasswordHasher,
  datos: DatosUsuarioPrueba,
): Promise<ResultadoUsuarioPrueba> {
  const roles = await database.query<{ id: number }>(
    `SELECT id FROM gestion.rol WHERE codigo = $1 AND activo`,
    [datos.rol],
  );
  const rol = roles[0];
  if (!rol) {
    throw new AppError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.UNPROCESSABLE,
      `El rol ${datos.rol} no existe o está desactivado.`,
    );
  }

  let areaId: number | null = null;
  if (datos.areaCodigo) {
    const areas = await database.query<{ id: number }>(`SELECT id FROM catalogo.area WHERE codigo = $1 AND activo`, [
      datos.areaCodigo,
    ]);
    if (!areas[0]) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.UNPROCESSABLE,
        `El área ${datos.areaCodigo} no existe o está desactivada.`,
      );
    }
    areaId = areas[0].id;
  }

  const correo = normalizarCorreo(datos.correo);
  const existentes = await database.query(`SELECT 1 FROM gestion.usuario_interno WHERE correo = $1`, [correo]);
  if (existentes.length > 0) return ResultadoUsuarioPrueba.EXISTENTE;

  const huella = await hasher.hash(datos.password);
  try {
    await database.transaction(ACTOR_SISTEMA_USUARIO_PRUEBA, async (tx) => {
      const filas = await tx.query<{ id: string }>(
        `INSERT INTO gestion.usuario_interno (nombre_completo, correo, password_hash, area_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [datos.nombreCompleto, correo, huella, areaId],
      );
      await tx.query(`INSERT INTO gestion.usuario_rol (usuario_interno_id, rol_id) VALUES ($1, $2)`, [
        (filas[0] as { id: string }).id,
        rol.id,
      ]);
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return ResultadoUsuarioPrueba.EXISTENTE;
    throw error;
  }
  return ResultadoUsuarioPrueba.CREADO;
}
