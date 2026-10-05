import { describe, expect, it } from "vitest";
import { ACTOR_SISTEMA_USUARIO_PRUEBA } from "@/database/actor.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { AppError } from "@/errors/app-error.js";
import {
  crearUsuarioDePrueba,
  leerDatosUsuarioPrueba,
  ResultadoUsuarioPrueba,
} from "@/services/usuario-prueba.service.js";
import { withRollbackDatabase, type RollbackContext } from "@/test-utils/rollback-database.js";
import { ArgonPasswordHasher } from "@/utils/password-hasher.js";

const url = process.env["TEST_DATABASE_URL"];
const hasher = new ArgonPasswordHasher();
const CLAVE = "clave-de-prueba-123";

const entorno = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  USUARIO_NOMBRE: "Gestora de Prueba",
  USUARIO_CORREO: "Gestor@Prueba.Local",
  USUARIO_PASSWORD: CLAVE,
  USUARIO_ROL: RolCodigo.GESTOR,
  DATABASE_URL: "postgresql://postgres@localhost:5432/gestion_desechable",
  ...overrides,
});

describe("leerDatosUsuarioPrueba", () => {
  it("devuelve los datos validados con el correo tal como se escribió", () => {
    expect(leerDatosUsuarioPrueba(entorno())).toEqual({
      nombreCompleto: "Gestora de Prueba",
      correo: "Gestor@Prueba.Local",
      password: CLAVE,
      rol: RolCodigo.GESTOR,
    });
  });

  it.each([
    RolCodigo.ADMINISTRADOR,
    RolCodigo.GESTOR,
    RolCodigo.AREA_DENUNCIA_CORRUPCION,
    RolCodigo.AREA_QUEJA,
    RolCodigo.AREA_RECLAMO,
  ])("acepta el rol vigente %s", (rol) => {
    expect(leerDatosUsuarioPrueba(entorno({ USUARIO_ROL: rol })).rol).toBe(rol);
  });

  it("rechaza el rol retirado REVISOR y un rol desconocido", () => {
    expect(() => leerDatosUsuarioPrueba(entorno({ USUARIO_ROL: RolCodigo.REVISOR }))).toThrow();
    expect(() => leerDatosUsuarioPrueba(entorno({ USUARIO_ROL: "SUPERUSUARIO" }))).toThrow();
  });

  it("rechaza un correo inválido, un nombre vacío y una clave corta", () => {
    expect(() => leerDatosUsuarioPrueba(entorno({ USUARIO_CORREO: "no-es-correo" }))).toThrow();
    expect(() => leerDatosUsuarioPrueba(entorno({ USUARIO_NOMBRE: "   " }))).toThrow();
    expect(() => leerDatosUsuarioPrueba(entorno({ USUARIO_PASSWORD: "corta" }))).toThrow();
  });

  it.each(["chatbot", "chatbot_prueba", "gestion", "produccion"])(
    "se niega a correr contra la base %s, que no es desechable",
    (nombre) => {
      expect(() =>
        leerDatosUsuarioPrueba(entorno({ DATABASE_URL: `postgresql://postgres@localhost:5432/${nombre}` })),
      ).toThrow(/desechable/);
    },
  );

  it("acepta las bases terminadas en _desechable, _dev y _local", () => {
    for (const nombre of ["gestion_desechable", "gestion_dev", "gestion_local"]) {
      expect(() =>
        leerDatosUsuarioPrueba(entorno({ DATABASE_URL: `postgresql://postgres@localhost:5432/${nombre}` })),
      ).not.toThrow();
    }
  });

  it("no incluye la clave de la URL en el mensaje cuando rechaza la base", () => {
    expect(() =>
      leerDatosUsuarioPrueba(entorno({ DATABASE_URL: "postgresql://u:secreta@h:5432/produccion" })),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("secreta") }));
  });

  it("no incluye la clave de la persona en el mensaje cuando la validación falla", () => {
    expect(() => leerDatosUsuarioPrueba(entorno({ USUARIO_PASSWORD: "corta", USUARIO_ROL: "XX" }))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("corta") }),
    );
  });
});

describe.skipIf(!url)("crearUsuarioDePrueba contra PostgreSQL real", () => {
  const usar = (prueba: (contexto: RollbackContext) => Promise<void>) => withRollbackDatabase(url as string, prueba);
  const datos = (correo: string, rol: Parameters<typeof crearUsuarioDePrueba>[2]["rol"]) => ({
    nombreCompleto: "Persona de Prueba",
    correo,
    password: CLAVE,
    rol,
  });

  it("crea la persona con su rol activo, normaliza el correo y firma con el actor del script", async () => {
    await usar(async ({ database }) => {
      const resultado = await crearUsuarioDePrueba(database, hasher, datos("Gestor@Prueba.Local", RolCodigo.GESTOR));
      expect(resultado).toBe(ResultadoUsuarioPrueba.CREADO);

      const filas = await database.query<{ correo: string; rol: string; activo: boolean; creador: string; huella: string }>(
        `SELECT u.correo, r.codigo AS rol, r.activo, u.usuario_creacion AS creador, u.password_hash AS huella
           FROM gestion.usuario_interno u
           JOIN gestion.usuario_rol ur ON ur.usuario_interno_id = u.id
           JOIN gestion.rol r ON r.id = ur.rol_id
          WHERE u.correo = $1`,
        ["gestor@prueba.local"],
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        correo: "gestor@prueba.local",
        rol: RolCodigo.GESTOR,
        activo: true,
        creador: ACTOR_SISTEMA_USUARIO_PRUEBA,
      });
      expect(filas[0]?.huella).not.toContain(CLAVE);
      expect(await hasher.verify(filas[0]?.huella as string, CLAVE)).toBe(true);
    });
  });

  it.each([
    RolCodigo.ADMINISTRADOR,
    RolCodigo.AREA_DENUNCIA_CORRUPCION,
    RolCodigo.AREA_QUEJA,
    RolCodigo.AREA_RECLAMO,
  ])("crea una persona con el rol %s", async (rol) => {
    await usar(async ({ database }) => {
      await crearUsuarioDePrueba(database, hasher, datos("rol@prueba.local", rol));
      const filas = await database.query<{ rol: string }>(
        `SELECT r.codigo AS rol FROM gestion.usuario_rol ur
           JOIN gestion.usuario_interno u ON u.id = ur.usuario_interno_id
           JOIN gestion.rol r ON r.id = ur.rol_id
          WHERE u.correo = $1`,
        ["rol@prueba.local"],
      );
      expect(filas.map((fila) => fila.rol)).toEqual([rol]);
    });
  });

  it("es idempotente: si el correo ya existe, no duplica, no cambia la clave ni agrega roles", async () => {
    await usar(async ({ database }) => {
      await crearUsuarioDePrueba(database, hasher, datos("repetido@prueba.local", RolCodigo.GESTOR));
      const antes = await database.query<{ huella: string }>(
        `SELECT password_hash AS huella FROM gestion.usuario_interno WHERE correo = $1`,
        ["repetido@prueba.local"],
      );

      const resultado = await crearUsuarioDePrueba(database, hasher, {
        ...datos("Repetido@Prueba.Local", RolCodigo.AREA_QUEJA),
        password: "otra-clave-distinta-456",
      });
      expect(resultado).toBe(ResultadoUsuarioPrueba.EXISTENTE);

      const despues = await database.query<{ huella: string; roles: string }>(
        `SELECT u.password_hash AS huella, string_agg(r.codigo, ',') AS roles
           FROM gestion.usuario_interno u
           JOIN gestion.usuario_rol ur ON ur.usuario_interno_id = u.id
           JOIN gestion.rol r ON r.id = ur.rol_id
          WHERE u.correo = $1
          GROUP BY u.password_hash`,
        ["repetido@prueba.local"],
      );
      expect(despues).toHaveLength(1);
      expect(despues[0]?.huella).toBe(antes[0]?.huella);
      expect(despues[0]?.roles).toBe(RolCodigo.GESTOR);
    });
  });

  it("rechaza con un error claro un rol desactivado, como el REVISOR retirado, y no crea a la persona", async () => {
    await usar(async ({ database }) => {
      const promesa = crearUsuarioDePrueba(database, hasher, datos("revisor@prueba.local", RolCodigo.REVISOR as never));
      await expect(promesa).rejects.toBeInstanceOf(AppError);
      await expect(promesa).rejects.toThrow(/desactivado|no existe/i);

      const filas = await database.query(`SELECT 1 FROM gestion.usuario_interno WHERE correo = $1`, [
        "revisor@prueba.local",
      ]);
      expect(filas).toHaveLength(0);
    });
  });
});
