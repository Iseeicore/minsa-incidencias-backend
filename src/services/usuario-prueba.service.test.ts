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
  USUARIO_CORREO: "Gestor@Script-Prueba.Invalid",
  USUARIO_PASSWORD: CLAVE,
  USUARIO_ROL: RolCodigo.GESTOR,
  DATABASE_URL: "postgresql://postgres@localhost:5432/gestion_desechable",
  ...overrides,
});

describe("leerDatosUsuarioPrueba", () => {
  it("devuelve los datos validados con el correo tal como se escribió", () => {
    expect(leerDatosUsuarioPrueba(entorno())).toEqual({
      nombreCompleto: "Gestora de Prueba",
      correo: "Gestor@Script-Prueba.Invalid",
      password: CLAVE,
      rol: RolCodigo.GESTOR,
    });
  });

  it.each([
    RolCodigo.ADMINISTRADOR,
    RolCodigo.GESTOR,
    RolCodigo.OTRANS,
    RolCodigo.ESTABLECIMIENTO,
  ])("acepta el rol vigente %s", (rol) => {
    expect(leerDatosUsuarioPrueba(entorno({ USUARIO_ROL: rol })).rol).toBe(rol);
  });

  it("rechaza un rol desconocido", () => {
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
  /** Un área activa del tipo que exige el rol (la base rechaza un rol con tipo de área sin un área de ese tipo). */
  const areaDelRol = async ({ database }: RollbackContext, rol: string): Promise<string | undefined> => {
    const filas = await database.query<{ codigo: string }>(
      `SELECT a.codigo FROM gestion.rol r
         JOIN catalogo.area a ON a.tipo_area_id = r.tipo_area_id AND a.activo
        WHERE r.codigo = $1
        ORDER BY a.codigo LIMIT 1`,
      [rol],
    );
    return filas[0]?.codigo;
  };
  const datos = async (contexto: RollbackContext, correo: string, rol: Parameters<typeof crearUsuarioDePrueba>[2]["rol"]) => {
    const areaCodigo = await areaDelRol(contexto, rol);
    return { nombreCompleto: "Persona de Prueba", correo, password: CLAVE, rol, ...(areaCodigo ? { areaCodigo } : {}) };
  };

  it("crea la persona con su rol activo, normaliza el correo y firma con el actor del script", async () => {
    await usar(async (contexto) => {
      const { database } = contexto;
      const resultado = await crearUsuarioDePrueba(database, hasher, await datos(contexto, "Gestor@Script-Prueba.Invalid", RolCodigo.GESTOR));
      expect(resultado).toBe(ResultadoUsuarioPrueba.CREADO);

      const filas = await database.query<{ correo: string; rol: string; activo: boolean; creador: string; huella: string }>(
        `SELECT u.correo, r.codigo AS rol, r.activo, u.usuario_creacion AS creador, u.password_hash AS huella
           FROM gestion.usuario_interno u
           JOIN gestion.usuario_rol ur ON ur.usuario_interno_id = u.id
           JOIN gestion.rol r ON r.id = ur.rol_id
          WHERE u.correo = $1`,
        ["gestor@script-prueba.invalid"],
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        correo: "gestor@script-prueba.invalid",
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
    RolCodigo.OTRANS,
    RolCodigo.ESTABLECIMIENTO,
  ])("crea una persona con el rol %s", async (rol) => {
    await usar(async (contexto) => {
      const { database } = contexto;
      await crearUsuarioDePrueba(database, hasher, await datos(contexto, "rol@script-prueba.invalid", rol));
      const filas = await database.query<{ rol: string }>(
        `SELECT r.codigo AS rol FROM gestion.usuario_rol ur
           JOIN gestion.usuario_interno u ON u.id = ur.usuario_interno_id
           JOIN gestion.rol r ON r.id = ur.rol_id
          WHERE u.correo = $1`,
        ["rol@script-prueba.invalid"],
      );
      expect(filas.map((fila) => fila.rol)).toEqual([rol]);
    });
  });

  it("rechaza un área que no existe y no crea a la persona", async () => {
    await usar(async (contexto) => {
      const { database } = contexto;
      const datosConArea = { ...(await datos(contexto, "sin-area@script-prueba.invalid", RolCodigo.ESTABLECIMIENTO)), areaCodigo: "NO-EXISTE" };
      await expect(crearUsuarioDePrueba(database, hasher, datosConArea)).rejects.toThrow(/área .* no existe/i);
      const filas = await database.query(`SELECT 1 FROM gestion.usuario_interno WHERE correo = $1`, [
        "sin-area@script-prueba.invalid",
      ]);
      expect(filas).toHaveLength(0);
    });
  });

  it("es idempotente: si el correo ya existe, no duplica, no cambia la clave ni agrega roles", async () => {
    await usar(async (contexto) => {
      const { database } = contexto;
      await crearUsuarioDePrueba(database, hasher, await datos(contexto, "repetido@script-prueba.invalid", RolCodigo.GESTOR));
      const antes = await database.query<{ huella: string }>(
        `SELECT password_hash AS huella FROM gestion.usuario_interno WHERE correo = $1`,
        ["repetido@script-prueba.invalid"],
      );

      const resultado = await crearUsuarioDePrueba(database, hasher, {
        ...(await datos(contexto, "Repetido@Script-Prueba.Invalid", RolCodigo.OTRANS)),
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
        ["repetido@script-prueba.invalid"],
      );
      expect(despues).toHaveLength(1);
      expect(despues[0]?.huella).toBe(antes[0]?.huella);
      expect(despues[0]?.roles).toBe(RolCodigo.GESTOR);
    });
  });

  it("rechaza con un error claro un rol que no existe y no crea a la persona", async () => {
    await usar(async (contexto) => {
      const { database } = contexto;
      const promesa = crearUsuarioDePrueba(database, hasher, await datos(contexto, "revisor@script-prueba.invalid", "ROL_INEXISTENTE" as never));
      await expect(promesa).rejects.toBeInstanceOf(AppError);
      await expect(promesa).rejects.toThrow(/desactivado|no existe/i);

      const filas = await database.query(`SELECT 1 FROM gestion.usuario_interno WHERE correo = $1`, [
        "revisor@script-prueba.invalid",
      ]);
      expect(filas).toHaveLength(0);
    });
  });
});
