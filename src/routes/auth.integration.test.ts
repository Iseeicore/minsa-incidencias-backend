import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createLogger } from "@/config/logger.js";
import { PERMISOS_POR_ROL } from "@/constants/permisos-por-rol.js";
import { RolCodigo } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { errorHandler } from "@/middleware/error-handler.js";
import { attachSession, requireVista } from "@/middleware/session.js";
import { SesionRepository } from "@/repositories/sesion.repository.js";
import { UsuarioRepository } from "@/repositories/usuario.repository.js";
import { AuthService } from "@/services/auth.service.js";
import { crearAdministrador } from "@/services/administrador.service.js";
import { testEnv, TEST_COOKIE_SECRET } from "@/test-utils/env.js";
import { crearEstablecimientoDePrueba } from "@/test-utils/establecimientos.js";
import { withRollbackDatabase, type RollbackContext } from "@/test-utils/rollback-database.js";
import { ArgonPasswordHasher } from "@/utils/password-hasher.js";

const url = process.env["TEST_DATABASE_URL"];
const hasher = new ArgonPasswordHasher();
const CLAVE = "clave-de-prueba-123";

let huella = "";

/** El área que exige la base según el rol: OTRANS la suya; el gestor y el establecimiento, la de un establecimiento; el administrador, ninguna. */
async function areaQueExigenLosRoles(contexto: RollbackContext, roles: readonly string[]): Promise<string | null> {
  if (roles.includes(RolCodigo.OTRANS)) return "OTRANS";
  if (roles.includes(RolCodigo.GESTOR) || roles.includes(RolCodigo.ESTABLECIMIENTO)) {
    return (await crearEstablecimientoDePrueba(contexto)).areaCodigo;
  }
  return null;
}

async function crearUsuario(
  contexto: RollbackContext,
  correo: string,
  roles: string[],
  nombre = "Persona de Prueba",
  area?: string | null,
): Promise<void> {
  const { database } = contexto;
  const areaCodigo = area === undefined ? await areaQueExigenLosRoles(contexto, roles) : area;
  await database.transaction("usuario:admin-prueba", async (tx) => {
    const filas = await tx.query<{ id: string }>(
      `INSERT INTO gestion.usuario_interno (nombre_completo, correo, password_hash, area_id)
       VALUES ($1, $2, $3, (SELECT id FROM catalogo.area WHERE codigo = $4))
       RETURNING id`,
      [nombre, correo, huella, areaCodigo],
    );
    for (const rol of roles) {
      await tx.query(
        `INSERT INTO gestion.usuario_rol (usuario_interno_id, rol_id) SELECT $1, id FROM gestion.rol WHERE codigo = $2`,
        [(filas[0] as { id: string }).id, rol],
      );
    }
  });
}

const construir = (contexto: RollbackContext, overrides: Record<string, string> = {}) =>
  createApp(testEnv(overrides), contexto.database, createLogger(testEnv()), hasher);

describe.skipIf(!url)("autenticación contra PostgreSQL real", () => {
  const usar = (prueba: (contexto: RollbackContext) => Promise<void>) => withRollbackDatabase(url as string, prueba);

  beforeAll(async () => {
    huella = await hasher.hash(CLAVE);
  });

  it("login crea una sesión con cookie firmada y /auth/me devuelve nombre, correo, vistas, roles y área, sin id ni módulos", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.ADMINISTRADOR], "Ana Prueba");
      const agente = request.agent(construir(contexto));

      const login = await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      expect(login.status).toBe(204);
      const cookie = (login.headers["set-cookie"] as unknown as string[])[0] as string;
      expect(cookie).toContain("gestion_sid=s%3A");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Max-Age=28800");

      const me = await agente.get("/auth/me");
      expect(me.status).toBe(200);
      expect(Object.keys(me.body).sort()).toEqual(["area", "correo", "nombreCompleto", "roles", "vistas"]);
      expect(me.body.roles).toEqual(["ADMINISTRADOR"]);
      expect(me.body.area).toBeNull();
      expect(me.body.nombreCompleto).toBe("Ana Prueba");
      expect(me.body.vistas).toEqual(["INICIO", "CASOS", "BANDEJAS", "DERIVACIONES", "QR", "USUARIOS"]);
    });
  });

  it.each(Object.keys(PERMISOS_POR_ROL))("el rol %s abre las vistas de la tabla de permisos, consultado en la base", async (rol) => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [rol]);
      const agente = request.agent(construir(contexto));
      await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      expect((await agente.get("/auth/me")).body.vistas).toEqual(PERMISOS_POR_ROL[rol as keyof typeof PERMISOS_POR_ROL].vistas);
    });
  });

  it("Derivaciones solo para el administrador; Códigos QR y Usuarios solo para establecimiento y administrador", async () => {
    await usar(async (contexto) => {
      const eess = await crearEstablecimientoDePrueba(contexto);
      await crearUsuario(contexto, "otrans@minsa.gob.pe", [RolCodigo.OTRANS], "OTRANS", "OTRANS");
      await crearUsuario(contexto, "eess@minsa.gob.pe", [RolCodigo.ESTABLECIMIENTO], "Establecimiento", eess.areaCodigo);
      await crearUsuario(contexto, "gestor@minsa.gob.pe", [RolCodigo.GESTOR]);
      const app = construir(contexto);
      const vistasDe = async (correo: string) => {
        const agente = request.agent(app);
        await agente.post("/auth/login").send({ correo, password: CLAVE });
        return (await agente.get("/auth/me")).body.vistas as string[];
      };
      expect(await vistasDe("otrans@minsa.gob.pe")).toEqual(["INICIO", "CASOS", "BANDEJAS"]);
      expect(await vistasDe("eess@minsa.gob.pe")).toEqual(["INICIO", "CASOS", "BANDEJAS", "QR", "USUARIOS"]);
      expect(await vistasDe("gestor@minsa.gob.pe")).toEqual(["INICIO", "CASOS", "BANDEJAS"]);
    });
  });

  it("/auth/me devuelve el área de la persona (código, nombre y tipo), nunca su id", async () => {
    await usar(async (contexto) => {
      const eess = await crearEstablecimientoDePrueba(contexto);
      await crearUsuario(contexto, "eess@minsa.gob.pe", [RolCodigo.ESTABLECIMIENTO], "Establecimiento", eess.areaCodigo);
      await crearUsuario(contexto, "otrans@minsa.gob.pe", [RolCodigo.OTRANS], "OTRANS", "OTRANS");
      const app = construir(contexto);
      const meDe = async (correo: string) => {
        const agente = request.agent(app);
        await agente.post("/auth/login").send({ correo, password: CLAVE });
        return (await agente.get("/auth/me")).body;
      };
      const eessMe = await meDe("eess@minsa.gob.pe");
      expect(eessMe.area).toEqual({ codigo: eess.areaCodigo, nombre: eess.areaNombre, tipo: "ESTABLECIMIENTO" });
      expect((await meDe("otrans@minsa.gob.pe")).area).toEqual({ codigo: "OTRANS", nombre: "OTRANS", tipo: "OTRANS" });
      expect(Object.keys(eessMe).sort()).toEqual(["area", "correo", "nombreCompleto", "roles", "vistas"]);
      expect(eessMe.roles).toEqual(["ESTABLECIMIENTO"]);
      expect(eessMe.area).not.toHaveProperty("id");
    });
  });

  it("varios roles dan la unión de sus vistas sin repetir", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR, RolCodigo.ESTABLECIMIENTO]);
      const agente = request.agent(construir(contexto));
      await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      expect((await agente.get("/auth/me")).body.vistas).toEqual(["INICIO", "CASOS", "BANDEJAS", "QR", "USUARIOS"]);
    });
  });

  it("el gestor pertenece siempre a un establecimiento: la base rechaza darle ese rol sin área o con el área de OTRANS", async () => {
    await usar(async (contexto) => {
      await expect(crearUsuario(contexto, "g1@minsa.gob.pe", [RolCodigo.GESTOR], "G", null)).rejects.toThrow(/tipo de area del rol/);
      await expect(crearUsuario(contexto, "g2@minsa.gob.pe", [RolCodigo.GESTOR], "G", "OTRANS")).rejects.toThrow(/tipo de area del rol/);
    });
  });

  it("/auth/me del gestor trae el área de su establecimiento", async () => {
    await usar(async (contexto) => {
      const eess = await crearEstablecimientoDePrueba(contexto);
      await crearUsuario(contexto, "gestor@minsa.gob.pe", [RolCodigo.GESTOR], "Gestor", eess.areaCodigo);
      const agente = request.agent(construir(contexto));
      await agente.post("/auth/login").send({ correo: "gestor@minsa.gob.pe", password: CLAVE });
      const me = await agente.get("/auth/me");
      expect(me.body.roles).toEqual(["GESTOR"]);
      expect(me.body.area).toEqual({ codigo: eess.areaCodigo, nombre: eess.areaNombre, tipo: "ESTABLECIMIENTO" });
    });
  });

  it("la base rechaza un rol cuyo tipo de área no coincide con el área de la persona", async () => {
    await usar(async (contexto) => {
      const eess = await crearEstablecimientoDePrueba(contexto);
      await expect(crearUsuario(contexto, "x@minsa.gob.pe", [RolCodigo.OTRANS], "X", eess.areaCodigo)).rejects.toThrow(/tipo de area del rol/);
    });
  });

  it("un rol desactivado no da vistas y la sesión sigue válida", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR]);
      const agente = request.agent(construir(contexto));
      await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      expect((await agente.get("/auth/me")).body.vistas).toHaveLength(3);

      await contexto.client.query("UPDATE gestion.rol SET activo = false WHERE codigo = 'GESTOR'");

      const me = await agente.get("/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.vistas).toEqual([]);
    });
  });

  it("una persona sin ningún rol tiene sesión válida y vistas vacías", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "sin-rol@minsa.gob.pe", []);
      const agente = request.agent(construir(contexto));
      expect((await agente.post("/auth/login").send({ correo: "sin-rol@minsa.gob.pe", password: CLAVE })).status).toBe(204);
      const me = await agente.get("/auth/me");
      expect(me.status).toBe(200);
      expect(me.body.vistas).toEqual([]);
    });
  });

  it("DIRIS está desactivado: la base rechaza darle ese rol a una persona", async () => {
    await usar(async (contexto) => {
      await expect(crearUsuario(contexto, "diris@minsa.gob.pe", [RolCodigo.DIRIS])).rejects.toThrow(/desactivado/);
    });
  });

  it("clave incorrecta y correo inexistente responden exactamente lo mismo", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR]);
      const app = construir(contexto);
      const mala = await request(app).post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: "incorrecta" });
      const inexistente = await request(app).post("/auth/login").send({ correo: "nadie@minsa.gob.pe", password: "incorrecta" });
      expect(mala.status).toBe(401);
      expect(inexistente.status).toBe(401);
      expect(mala.body.errorCode).toBe("INVALID_CREDENTIALS");
      expect(inexistente.body.errorCode).toBe(mala.body.errorCode);
      expect(inexistente.body.message).toBe(mala.body.message);
      expect(mala.headers["set-cookie"]).toBeUndefined();
    });
  });

  it("un cuerpo inválido responde 400 con el detalle por campo", async () => {
    await usar(async (contexto) => {
      const res = await request(construir(contexto)).post("/auth/login").send({ correo: "no-es-correo" });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(["correo", "password"]);
    });
  });

  it("sin cookie o con una cookie alterada, /auth/me responde 401", async () => {
    await usar(async (contexto) => {
      const app = construir(contexto);
      expect((await request(app).get("/auth/me")).status).toBe(401);
      const falsa = await request(app).get("/auth/me").set("Cookie", "gestion_sid=s%3A0190b0c2-7e1a-7c3e-8f2b-1a2b3c4d5e6f.firma-falsa");
      expect(falsa.status).toBe(401);
      expect(falsa.body.errorCode).toBe("UNAUTHORIZED");
    });
  });

  it("logout revoca la sesión en la base y la cookie vieja deja de servir", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR]);
      const app = construir(contexto);
      const agente = request.agent(app);
      const login = await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      const cookieVieja = login.headers["set-cookie"] as unknown as string[];
      expect((await agente.get("/auth/me")).status).toBe(200);

      expect((await agente.post("/auth/logout")).status).toBe(204);

      const filas = await contexto.database.query<{ revocada_en: Date | null }>(
        `SELECT s.revocada_en FROM gestion.sesion_usuario s
           JOIN gestion.usuario_interno u ON u.id = s.usuario_interno_id
          WHERE u.correo = 'ana@minsa.gob.pe'`,
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]?.revocada_en).not.toBeNull();

      const conCookieVieja = await request(app).get("/auth/me").set("Cookie", cookieVieja);
      expect(conCookieVieja.status).toBe(401);
      expect(conCookieVieja.body.errorCode).toBe("INVALID_SESSION");
    });
  });

  it("al desactivar al usuario su sesión deja de servir y el login se rechaza", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR]);
      const agente = request.agent(construir(contexto));
      await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });

      await contexto.client.query(
        "UPDATE gestion.usuario_interno SET activo = false, eliminado_en = now(), eliminado_por = 'usuario:admin-prueba' WHERE correo = 'ana@minsa.gob.pe'",
      );

      const me = await agente.get("/auth/me");
      expect(me.status).toBe(401);
      expect(me.body.errorCode).toBe("INVALID_SESSION");
      expect((me.headers["set-cookie"] as unknown as string[])[0]).toContain("Expires=Thu, 01 Jan 1970");

      const login = await request(construir(contexto)).post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      expect(login.status).toBe(401);
    });
  });

  it("una sesión inactiva más de 30 minutos o pasada de sus 8 horas deja de servir", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR]);
      const agente = request.agent(construir(contexto));
      await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      expect((await agente.get("/auth/me")).status).toBe(200);

      await contexto.client.query("ALTER TABLE gestion.sesion_usuario DISABLE TRIGGER USER");
      await contexto.client.query("UPDATE gestion.sesion_usuario SET ultima_actividad_en = now() - interval '31 minutes'");
      const inactiva = await agente.get("/auth/me");
      expect(inactiva.status).toBe(401);
      expect(inactiva.body.errorCode).toBe("INVALID_SESSION");

      await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });
      await contexto.client.query("UPDATE gestion.sesion_usuario SET vence_en = now() - interval '1 minute' WHERE revocada_en IS NULL");
      expect((await agente.get("/auth/me")).status).toBe(401);
    });
  });

  it("renueva la actividad cuando pasó más de un minuto y firma quién la renovó", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR]);
      const agente = request.agent(construir(contexto));
      await agente.post("/auth/login").send({ correo: "ana@minsa.gob.pe", password: CLAVE });

      const deAna = "usuario_interno_id = (SELECT id FROM gestion.usuario_interno WHERE correo = 'ana@minsa.gob.pe')";
      await contexto.client.query("ALTER TABLE gestion.sesion_usuario DISABLE TRIGGER USER");
      await contexto.client.query(`UPDATE gestion.sesion_usuario SET ultima_actividad_en = now() - interval '5 minutes' WHERE ${deAna}`);
      await contexto.client.query("ALTER TABLE gestion.sesion_usuario ENABLE TRIGGER USER");

      expect((await agente.get("/auth/me")).status).toBe(200);
      const [fila] = await contexto.database.query<{ renovada: boolean; version_fila: number; usuario_modificacion: string }>(
        `SELECT ultima_actividad_en > now() - interval '1 minute' AS renovada, version_fila, usuario_modificacion
           FROM gestion.sesion_usuario WHERE ${deAna}`,
      );
      expect(fila).toEqual({ renovada: true, version_fila: 2, usuario_modificacion: "usuario:ana@minsa.gob.pe" });
    });
  });

  it("requireVista responde 403 si el usuario no tiene la vista y deja pasar si la tiene", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "sin-rol@minsa.gob.pe", []);
      await crearUsuario(contexto, "adm@minsa.gob.pe", [RolCodigo.ADMINISTRADOR]);
      const env = testEnv();
      const auth = new AuthService(new UsuarioRepository(contexto.database), new SesionRepository(contexto.database), hasher, env);
      const mini = express();
      mini.use(cookieParser(TEST_COOKIE_SECRET));
      mini.use(attachSession(auth, env));
      mini.get("/casos", requireVista(VistaCodigo.CASOS), (_req, res) => {
        res.json({ ok: true });
      });
      mini.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
        Object.assign(req, { log: { error: () => undefined } });
        errorHandler(error, req, res, next);
      });

      const app = construir(contexto);
      const sinRol = request.agent(app);
      const admin = request.agent(app);
      const cookieSinRol = (await sinRol.post("/auth/login").send({ correo: "sin-rol@minsa.gob.pe", password: CLAVE })).headers["set-cookie"] as unknown as string[];
      const cookieAdmin = (await admin.post("/auth/login").send({ correo: "adm@minsa.gob.pe", password: CLAVE })).headers["set-cookie"] as unknown as string[];

      const prohibido = await request(mini).get("/casos").set("Cookie", cookieSinRol);
      expect(prohibido.status).toBe(403);
      expect(prohibido.body.errorCode).toBe("FORBIDDEN");
      expect((await request(mini).get("/casos").set("Cookie", cookieAdmin)).status).toBe(200);
      expect((await request(mini).get("/casos")).status).toBe(401);
    });
  });

  it("limita el login a 5 intentos por correo, aunque cambie la IP", async () => {
    await usar(async (contexto) => {
      await crearUsuario(contexto, "ana@minsa.gob.pe", [RolCodigo.GESTOR]);
      const app = construir(contexto);
      for (let i = 0; i < 5; i += 1) {
        const res = await request(app).post("/auth/login").set("X-Forwarded-For", `10.0.0.${i}`).send({ correo: "ana@minsa.gob.pe", password: "mala" });
        expect(res.status).toBe(401);
      }
      const sexto = await request(app).post("/auth/login").set("X-Forwarded-For", "10.0.9.9").send({ correo: "ANA@minsa.gob.pe", password: CLAVE });
      expect(sexto.status).toBe(429);
      expect(sexto.headers["retry-after"]).toBe("180");
    });
  });

  it("crearAdministrador crea un usuario con el rol ADMINISTRADOR y rechaza un correo repetido", async () => {
    await usar(async (contexto) => {
      await crearAdministrador(contexto.database, hasher, { nombreCompleto: "Admin Inicial", correo: "Admin@Minsa.gob.pe", password: CLAVE });

      const filas = await contexto.database.query<{ correo: string; usuario_creacion: string; rol: string; password_hash: string }>(
        `SELECT u.correo, u.usuario_creacion, r.codigo AS rol, u.password_hash
           FROM gestion.usuario_interno u
           JOIN gestion.usuario_rol ur ON ur.usuario_interno_id = u.id
           JOIN gestion.rol r ON r.id = ur.rol_id
          WHERE u.correo = 'admin@minsa.gob.pe'`,
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({ correo: "admin@minsa.gob.pe", usuario_creacion: "sistema:crear-admin", rol: "ADMINISTRADOR" });
      expect(filas[0]?.password_hash.startsWith("$argon2id$")).toBe(true);

      const agente = request.agent(construir(contexto));
      expect((await agente.post("/auth/login").send({ correo: "admin@minsa.gob.pe", password: CLAVE })).status).toBe(204);

      await expect(
        crearAdministrador(contexto.database, hasher, { nombreCompleto: "Otro", correo: "admin@minsa.gob.pe", password: CLAVE }),
      ).rejects.toMatchObject({ statusCode: 409, errorCode: "CONFLICT" });
    });
  });

  it("crearAdministrador acepta el código de un área y la guarda; con un área que no existe responde 422", async () => {
    await usar(async (contexto) => {
      const eess = await crearEstablecimientoDePrueba(contexto);
      await crearAdministrador(contexto.database, hasher, {
        nombreCompleto: "Admin de Área",
        correo: "admin-area@minsa.gob.pe",
        password: CLAVE,
        areaCodigo: eess.areaCodigo,
      });
      const [fila] = await contexto.database.query<{ area: string }>(
        "SELECT a.codigo AS area FROM gestion.usuario_interno u JOIN catalogo.area a ON a.id = u.area_id WHERE u.correo = 'admin-area@minsa.gob.pe'",
      );
      expect(fila?.area).toBe(eess.areaCodigo);

      await expect(
        crearAdministrador(contexto.database, hasher, { nombreCompleto: "X", correo: "x@minsa.gob.pe", password: CLAVE, areaCodigo: "NO-EXISTE" }),
      ).rejects.toMatchObject({ statusCode: 422, errorCode: "UNPROCESSABLE" });
    });
  });

  it("el enum de roles coincide con el catálogo y la tabla de permisos con los roles activos", async () => {
    await usar(async ({ database }) => {
      const roles = await database.query<{ codigo: string; activo: boolean }>("SELECT codigo, activo FROM gestion.rol");
      expect(roles.map((r) => r.codigo).sort()).toEqual(Object.values(RolCodigo).sort());
      expect(roles.filter((r) => r.activo).map((r) => r.codigo).sort()).toEqual(Object.keys(PERMISOS_POR_ROL).sort());
    });
  });

  it("la base ya no tiene las tablas de módulos", async () => {
    await usar(async ({ database }) => {
      const filas = await database.query<{ modulo: string | null; rol_modulo: string | null }>(
        "SELECT to_regclass('gestion.modulo') AS modulo, to_regclass('gestion.rol_modulo') AS rol_modulo",
      );
      expect(filas[0]).toEqual({ modulo: null, rol_modulo: null });
    });
  });
});
