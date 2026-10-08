import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import type { RollbackContext } from "@/test-utils/rollback-database.js";
import { ArgonPasswordHasher } from "@/utils/password-hasher.js";

export type AgentePrueba = ReturnType<typeof request.agent>;

export const CLAVE_DE_PRUEBA = "clave-de-prueba-123";

const hasher = new ArgonPasswordHasher();
let huella: Promise<string> | null = null;

export async function crearUsuarioDePrueba(
  { database }: RollbackContext,
  roles: readonly string[],
  nombre = "Persona de Prueba",
  correo = `prueba-${randomUUID()}@minsa.gob.pe`,
  areaCodigo: string | null = null,
): Promise<string> {
  huella ??= hasher.hash(CLAVE_DE_PRUEBA);
  const hash = await huella;
  await database.transaction("usuario:admin-prueba", async (tx) => {
    const [fila] = await tx.query<{ id: string }>(
      `INSERT INTO gestion.usuario_interno (nombre_completo, correo, password_hash, area_id)
       VALUES ($1, $2, $3, (SELECT id FROM catalogo.area WHERE codigo = $4))
       RETURNING id`,
      [nombre, correo, hash, areaCodigo],
    );
    for (const rol of roles) {
      await tx.query(
        "INSERT INTO gestion.usuario_rol (usuario_interno_id, rol_id) SELECT $1, id FROM gestion.rol WHERE codigo = $2",
        [(fila as { id: string }).id, rol],
      );
    }
  });
  return correo;
}

export async function iniciarSesion(app: Express, correo: string): Promise<AgentePrueba> {
  const agente = request.agent(app);
  const respuesta = await agente.post("/auth/login").send({ correo, password: CLAVE_DE_PRUEBA });
  if (respuesta.status !== 204) throw new Error(`no se pudo iniciar sesión (${respuesta.status})`);
  return agente;
}
