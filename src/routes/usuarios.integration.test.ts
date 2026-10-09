import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createLogger } from "@/config/logger.js";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { testEnv } from "@/test-utils/env.js";
import { crearEstablecimientoDePrueba, type EstablecimientoDePrueba } from "@/test-utils/establecimientos.js";
import { withRollbackDatabase, type RollbackContext } from "@/test-utils/rollback-database.js";
import { crearUsuarioDePrueba, iniciarSesion, type AgentePrueba } from "@/test-utils/usuarios.js";

const url = process.env["TEST_DATABASE_URL"];

const construir = (contexto: RollbackContext) => createApp(testEnv(), contexto.database, createLogger(testEnv()));

interface UsuarioDto {
  id: string;
  nombreCompleto: string;
  correo: string;
  rol: string | null;
  activo: boolean;
  area: { codigo: string; nombre: string } | null;
}

const correoNuevo = (prefijo = "nuevo"): string => `${prefijo}-${randomUUID()}@minsa.gob.pe`;

/** Quien es de OTRANS pertenece al área OTRANS; el gestor y el responsable, al área del establecimiento dado; el administrador, a ninguna. */
function areaDe(roles: string[], eess?: EstablecimientoDePrueba): string | null {
  if (roles.includes(R.OTRANS)) return "OTRANS";
  if (roles.includes(R.ESTABLECIMIENTO) || roles.includes(R.GESTOR)) {
    if (!eess) throw new Error("necesita su establecimiento");
    return eess.areaCodigo;
  }
  return null;
}

async function entrar(contexto: RollbackContext, app: ReturnType<typeof construir>, roles: string[], eess?: EstablecimientoDePrueba, nombre?: string) {
  const correo = await crearUsuarioDePrueba(contexto, roles, nombre, undefined, areaDe(roles, eess));
  return { agente: await iniciarSesion(app, correo), correo };
}

async function listar(agente: AgentePrueba, consulta: Record<string, string> = {}): Promise<UsuarioDto[]> {
  const res = await agente.get("/usuarios").query({ limite: "200", ...consulta });
  expect(res.status).toBe(200);
  return res.body.items as UsuarioDto[];
}

const correosDe = (usuarios: UsuarioDto[]): string[] => usuarios.map((u) => u.correo).sort();

async function crear(agente: AgentePrueba, cuerpo: Record<string, unknown>) {
  return agente.post("/usuarios").send({ nombreCompleto: "Persona Nueva", correo: correoNuevo(), ...cuerpo });
}

async function estadoDeSesion(app: ReturnType<typeof construir>, cookie: string[]): Promise<number> {
  return (await request(app).get("/auth/me").set("Cookie", cookie)).status;
}

async function loginConClave(app: ReturnType<typeof construir>, correo: string, password: string) {
  return request(app).post("/auth/login").send({ correo, password });
}

describe.skipIf(!url)("usuarios contra PostgreSQL real", () => {
  // Cada prueba corre en una transacción que se revierte: los usuarios creados no ocupan el tope de la base ni dejan basura.
  const usar = (prueba: (contexto: RollbackContext) => Promise<void>) => withRollbackDatabase(url as string, prueba);

  describe("acceso", () => {
    it("exige sesión y la vista de usuarios: el gestor y OTRANS reciben 403; el administrador y el establecimiento, no", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        expect((await request(app).get("/usuarios")).status).toBe(401);
        expect((await request(app).post("/usuarios").send({})).status).toBe(401);

        const gestor = await entrar(contexto, app, [R.GESTOR], eess);
        const otrans = await entrar(contexto, app, [R.OTRANS]);
        for (const { agente } of [gestor, otrans]) {
          expect((await agente.get("/usuarios")).status).toBe(403);
          expect((await crear(agente, { rol: "GESTOR", area: eess.areaCodigo })).status).toBe(403);
          expect((await agente.patch(`/usuarios/${randomUUID()}`).send({ activo: false })).status).toBe(403);
          expect((await agente.post(`/usuarios/${randomUUID()}/restablecer-clave`)).status).toBe(403);
        }
        expect((await (await entrar(contexto, app, [R.ADMINISTRADOR])).agente.get("/usuarios")).status).toBe(200);
        expect((await (await entrar(contexto, app, [R.ESTABLECIMIENTO], eess)).agente.get("/usuarios")).status).toBe(200);
      });
    });
  });

  describe("crear", () => {
    it("el administrador crea un gestor en un establecimiento: la clave sale una sola vez, en la base solo queda la huella y el usuario entra con ella", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente, correo: correoAdmin } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const correo = correoNuevo("mayusculas");

        const res = await crear(agente, { nombreCompleto: "  Gina Gestora  ", correo: `  ${correo.toUpperCase()}  `, rol: "GESTOR", area: eess.areaCodigo });
        expect(res.status).toBe(201);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(Object.keys(res.body).sort()).toEqual(["claveInicial", "usuario"]);
        expect(Object.keys(res.body.usuario).sort()).toEqual(["activo", "area", "correo", "id", "nombreCompleto", "rol"]);
        expect(res.body.usuario).toMatchObject({
          nombreCompleto: "Gina Gestora",
          correo,
          rol: "GESTOR",
          activo: true,
          area: { codigo: eess.areaCodigo, nombre: eess.areaNombre },
        });
        const clave = res.body.claveInicial as string;
        expect(clave.length).toBeGreaterThanOrEqual(16);
        expect(clave).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);

        const [fila] = await contexto.database.query<{ password_hash: string; usuario_creacion: string; rol_creado_por: string; activo: boolean }>(
          `SELECT u.password_hash, u.usuario_creacion, ur.usuario_creacion AS rol_creado_por, u.activo
             FROM gestion.usuario_interno u JOIN gestion.usuario_rol ur ON ur.usuario_interno_id = u.id
            WHERE u.correo = $1`,
          [correo],
        );
        expect(fila?.password_hash.startsWith("$argon2id$")).toBe(true);
        expect(fila?.password_hash).not.toContain(clave);
        expect(fila).toMatchObject({ usuario_creacion: `usuario:${correoAdmin}`, rol_creado_por: `usuario:${correoAdmin}`, activo: true });

        // La clave sirve para entrar, y la persona queda en su establecimiento sin cambio obligatorio de clave.
        const nuevo = request.agent(app);
        expect((await nuevo.post("/auth/login").send({ correo, password: clave })).status).toBe(204);
        const me = await nuevo.get("/auth/me");
        expect(me.body).toMatchObject({ roles: ["GESTOR"], area: { codigo: eess.areaCodigo, tipo: "ESTABLECIMIENTO" } });
        expect(me.body.vistas).not.toContain("USUARIOS");

        // Ninguna respuesta posterior vuelve a mostrarla.
        const texto = JSON.stringify([(await agente.get("/usuarios").query({ q: correo })).body, (await agente.get("/auth/me")).body, me.body]);
        expect(texto).not.toContain(clave);
        expect(texto).not.toContain("argon2");
        expect(texto).not.toContain("claveInicial");
      });
    });

    it("el responsable del establecimiento crea siempre en SU área, aunque el cuerpo pida otra, y solo gestor o establecimiento", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const mia = await crearEstablecimientoDePrueba(contexto);
        const ajena = await crearEstablecimientoDePrueba(contexto);
        const { agente, correo: miCorreo } = await entrar(contexto, app, [R.ESTABLECIMIENTO], mia);

        const gestor = await crear(agente, { rol: "GESTOR", area: ajena.areaCodigo });
        expect(gestor.status).toBe(201);
        expect(gestor.body.usuario.area).toEqual({ codigo: mia.areaCodigo, nombre: mia.areaNombre });
        const otro = await crear(agente, { rol: "ESTABLECIMIENTO" });
        expect(otro.status).toBe(201);
        expect(otro.body.usuario).toMatchObject({ rol: "ESTABLECIMIENTO", area: { codigo: mia.areaCodigo } });

        const [creado] = await contexto.database.query<{ usuario_creacion: string }>(
          "SELECT usuario_creacion FROM gestion.usuario_interno WHERE correo = $1",
          [gestor.body.usuario.correo],
        );
        expect(creado?.usuario_creacion).toBe(`usuario:${miCorreo}`);

        // Nunca un rol que no puede asignar.
        for (const rol of ["ADMINISTRADOR", "OTRANS"]) {
          const res = await crear(agente, { rol, area: rol === "OTRANS" ? "OTRANS" : undefined });
          expect(res.status, rol).toBe(403);
          expect(res.body.errorCode).toBe("FORBIDDEN");
        }
        expect((await crear(agente, { rol: "DIRIS" })).status).toBe(400);
        const ajenos = await contexto.database.query<{ n: string }>(
          "SELECT count(*)::text AS n FROM gestion.usuario_interno u JOIN catalogo.area a ON a.id = u.area_id WHERE a.codigo = $1",
          [ajena.areaCodigo],
        );
        expect(ajenos[0]?.n).toBe("0");
      });
    });

    it("el administrador debe indicar el área de un gestor, de un establecimiento y de OTRANS; el administrador nuevo no lleva área", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);

        for (const rol of ["GESTOR", "ESTABLECIMIENTO", "OTRANS"]) {
          const sinArea = await crear(agente, { rol });
          expect(sinArea.status, rol).toBe(422);
          expect(sinArea.body.errorCode).toBe("UNPROCESSABLE");
        }
        expect((await crear(agente, { rol: "GESTOR", area: "EESS-NO-EXISTE" })).status).toBe(422);
        expect((await crear(agente, { rol: "ADMINISTRADOR", area: eess.areaCodigo })).status).toBe(422);

        const admin = await crear(agente, { rol: "ADMINISTRADOR" });
        expect(admin.status).toBe(201);
        expect(admin.body.usuario).toMatchObject({ rol: "ADMINISTRADOR", area: null });
        const otrans = await crear(agente, { rol: "OTRANS", area: "OTRANS" });
        expect(otrans.status).toBe(201);
        expect(otrans.body.usuario).toMatchObject({ rol: "OTRANS", area: { codigo: "OTRANS" } });
      });
    });

    it("la base rechaza un rol con un área de otro tipo (422) y un área desactivada", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const desactivada = await crearEstablecimientoDePrueba(contexto);
        await contexto.database.transaction("sistema:prueba", (tx) => tx.query("UPDATE catalogo.area SET activo = false WHERE id = $1", [desactivada.areaId]));
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        expect((await crear(agente, { rol: "OTRANS", area: eess.areaCodigo })).status).toBe(422);
        expect((await crear(agente, { rol: "GESTOR", area: "OTRANS" })).status).toBe(422);
        expect((await crear(agente, { rol: "GESTOR", area: desactivada.areaCodigo })).status).toBe(422);
      });
    });

    it("un correo repetido responde 409 CORREO_REPETIDO, también con otras mayúsculas, y no crea nada", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const otra = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], eess);
        const correo = correoNuevo("repetido");
        expect((await crear(agente, { correo, rol: "GESTOR" })).status).toBe(201);
        for (const repetido of [correo, correo.toUpperCase(), `  ${correo}  `]) {
          const res = await crear(agente, { correo: repetido, rol: "GESTOR" });
          expect(res.status).toBe(409);
          expect(res.body.errorCode).toBe("CORREO_REPETIDO");
          expect(res.body).not.toHaveProperty("claveInicial");
        }
        // También si el correo ya lo usa alguien de otra área.
        const ajeno = await crearUsuarioDePrueba(contexto, [R.GESTOR], undefined, undefined, otra.areaCodigo);
        expect((await crear(agente, { correo: ajeno, rol: "GESTOR" })).body.errorCode).toBe("CORREO_REPETIDO");
        const n = await contexto.database.query<{ n: string }>("SELECT count(*)::text AS n FROM gestion.usuario_interno WHERE correo = $1", [correo]);
        expect(n[0]?.n).toBe("1");
      });
    });

    it("valida el cuerpo: correo, nombre y rol (400) sin tocar la base", async () => {
      await usar(async (contexto) => {
        const { agente } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        for (const cuerpo of [{ correo: "no-es-correo" }, { nombreCompleto: "  " }, { nombreCompleto: "Al" }, { rol: "SUPERUSUARIO" }, { rol: undefined }]) {
          const res = await crear(agente, { rol: "ADMINISTRADOR", ...cuerpo });
          expect(res.status, JSON.stringify(cuerpo)).toBe(400);
          expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        }
      });
    });

    it("el tope de 3 usuarios activos por establecimiento responde 409 LIMITE_USUARIOS_ESTABLECIMIENTO; desactivar uno libera el cupo y reactivar con el establecimiento lleno vuelve a fallar", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const otro = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], eess);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);

        const segundo = await crear(agente, { rol: "GESTOR" });
        const tercero = await crear(agente, { rol: "GESTOR" });
        expect([segundo.status, tercero.status]).toEqual([201, 201]);

        const cuarto = await crear(agente, { rol: "GESTOR" });
        expect(cuarto.status).toBe(409);
        expect(cuarto.body.errorCode).toBe("LIMITE_USUARIOS_ESTABLECIMIENTO");
        expect(cuarto.body.message).toContain("3 usuarios activos");
        expect(cuarto.body.message).not.toContain("usuario_interno");
        // También para el administrador: el tope vale para todos.
        const delAdmin = await crear(admin.agente, { rol: "GESTOR", area: eess.areaCodigo });
        expect(delAdmin.body.errorCode).toBe("LIMITE_USUARIOS_ESTABLECIMIENTO");
        // Otro establecimiento tiene su propio tope.
        expect((await crear(admin.agente, { rol: "GESTOR", area: otro.areaCodigo })).status).toBe(201);

        const desactivado = await agente.patch(`/usuarios/${tercero.body.usuario.id}`).send({ activo: false });
        expect(desactivado.status).toBe(200);
        expect(desactivado.body.usuario.activo).toBe(false);
        const reemplazo = await crear(agente, { rol: "GESTOR" });
        expect(reemplazo.status).toBe(201);

        const reactivar = await agente.patch(`/usuarios/${tercero.body.usuario.id}`).send({ activo: true });
        expect(reactivar.status).toBe(409);
        expect(reactivar.body.errorCode).toBe("LIMITE_USUARIOS_ESTABLECIMIENTO");
        const [estado] = await contexto.database.query<{ activo: boolean }>("SELECT activo FROM gestion.usuario_interno WHERE id = $1", [tercero.body.usuario.id]);
        expect(estado?.activo).toBe(false);
      });
    });
  });

  describe("listar", () => {
    it("el responsable solo ve los usuarios de su establecimiento, aunque pida otra área; el administrador ve todos y filtra por área", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const delA = await entrar(contexto, app, [R.ESTABLECIMIENTO], a);
        const gestorA = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Gestor A", undefined, a.areaCodigo);
        const gestorB = await crearUsuarioDePrueba(contexto, [R.GESTOR], "Gestor B", undefined, b.areaCodigo);
        const admin = await entrar(contexto, app, [R.ADMINISTRADOR]);

        expect(correosDe(await listar(delA.agente))).toEqual([delA.correo, gestorA].sort());
        expect(correosDe(await listar(delA.agente, { area: b.areaCodigo }))).toEqual([delA.correo, gestorA].sort());
        expect(correosDe(await listar(delA.agente, { area: "OTRANS" }))).toEqual([delA.correo, gestorA].sort());

        expect(correosDe(await listar(admin.agente, { area: b.areaCodigo }))).toEqual([gestorB]);
        expect(correosDe(await listar(admin.agente, { area: a.areaCodigo }))).toEqual([delA.correo, gestorA].sort());
        expect(await listar(admin.agente, { area: "EESS-NO-EXISTE" })).toEqual([]);
        const todos = correosDe(await listar(admin.agente));
        for (const correo of [delA.correo, gestorA, gestorB, admin.correo]) expect(todos).toContain(correo);
      });
    });

    it("trae nombre, correo, rol, estado y área; nunca la huella ni ids internos de área", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], eess, "Rosa Responsable");
        const res = await agente.get("/usuarios");
        expect(Object.keys(res.body).sort()).toEqual(["hayMas", "items", "siguiente"]);
        expect(res.body.items).toEqual([
          { id: expect.stringMatching(/^[0-9a-f-]{36}$/), nombreCompleto: "Rosa Responsable", correo, rol: "ESTABLECIMIENTO", activo: true, area: { codigo: eess.areaCodigo, nombre: eess.areaNombre } },
        ]);
        expect(JSON.stringify(res.body)).not.toContain("argon2");
        expect(JSON.stringify(res.body)).not.toContain("password");
      });
    });

    it("busca sin tildes ni mayúsculas por nombre o correo y trata % y _ como texto", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const marca = `zq${randomUUID().replace(/[^a-f]/g, "")}`;
        const app = construir(contexto);
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], eess);
        const ana = await crearUsuarioDePrueba(contexto, [R.GESTOR], `Úrsula ${marca} Ñandú`, `ursula.${marca}@minsa.gob.pe`, eess.areaCodigo);

        expect(correosDe(await listar(agente, { q: `ursula ${marca} nandu` }))).toEqual([ana]);
        expect(correosDe(await listar(agente, { q: `ÚRSULA ${marca.toUpperCase()}` }))).toEqual([ana]);
        expect(correosDe(await listar(agente, { q: `ursula.${marca}@MINSA` }))).toEqual([ana]);
        expect(await listar(agente, { q: `${marca}%` })).toEqual([]);
        expect(await listar(agente, { q: `_${marca.slice(1)}` })).toEqual([]);
        expect(await listar(agente, { q: "'; DROP TABLE gestion.usuario_interno; --" })).toEqual([]);
      });
    });

    it("pagina por cursor (nombre e id) sin repetir ni saltar con cualquier límite, y un cursor inválido responde 400", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const marca = `zq${randomUUID().replace(/[^a-f]/g, "")}`;
        const eess = await crearEstablecimientoDePrueba(contexto);
        const otra = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        // El tope es por establecimiento: se reparten entre varios para tener muchos usuarios con el mismo nombre.
        const areas = [eess, otra, await crearEstablecimientoDePrueba(contexto), await crearEstablecimientoDePrueba(contexto)];
        for (const area of areas) {
          for (let n = 0; n < 3; n += 1) await crearUsuarioDePrueba(contexto, [R.GESTOR], `${marca} Mismo Nombre`, undefined, area.areaCodigo);
        }
        const esperado = (await listar(agente, { q: marca })).map((u) => u.id);
        expect(esperado).toHaveLength(12);
        expect(new Set(esperado).size).toBe(12);

        for (const limite of [1, 5, 11, 12, 13]) {
          const vistos: string[] = [];
          let cursor: string | undefined;
          let paginas = 0;
          do {
            const res = await agente.get("/usuarios").query({ q: marca, limite: String(limite), ...(cursor ? { cursor } : {}) });
            expect(res.status).toBe(200);
            expect(res.body.hayMas).toBe(res.body.siguiente !== null);
            vistos.push(...(res.body.items as UsuarioDto[]).map((u) => u.id));
            cursor = res.body.siguiente ?? undefined;
            paginas += 1;
          } while (cursor);
          expect(vistos).toEqual(esperado);
          expect(paginas).toBe(Math.ceil(12 / limite));
        }
        for (const cursor of ["basura", Buffer.from("1 OR 1=1|x").toString("base64url")]) {
          const res = await agente.get("/usuarios").query({ cursor });
          expect(res.status).toBe(400);
          expect(res.body.errorCode).toBe("VALIDATION_FAILED");
        }
      });
    });
  });

  describe("alcance: un usuario de otra área es un 404", () => {
    it("el responsable no ve, edita, desactiva ni restablece la clave de un usuario de otro establecimiento, de OTRANS ni de un administrador", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const mia = await crearEstablecimientoDePrueba(contexto);
        const ajena = await crearEstablecimientoDePrueba(contexto);
        const yo = await entrar(contexto, app, [R.ESTABLECIMIENTO], mia);
        const otras = {
          deOtroEstablecimiento: await entrar(contexto, app, [R.GESTOR], ajena),
          deOtrans: await entrar(contexto, app, [R.OTRANS]),
          administrador: await entrar(contexto, app, [R.ADMINISTRADOR]),
        };
        const idInexistente = randomUUID();

        for (const [nombre, ajeno] of Object.entries(otras)) {
          const [fila] = await contexto.database.query<{ id: string; hash: string }>(
            "SELECT id, password_hash AS hash FROM gestion.usuario_interno WHERE correo = $1",
            [ajeno.correo],
          );
          const id = (fila as { id: string }).id;
          const esperado = (await yo.agente.patch(`/usuarios/${idInexistente}`).send({ activo: false })).body;
          for (const res of [
            await yo.agente.patch(`/usuarios/${id}`).send({ activo: false }),
            await yo.agente.patch(`/usuarios/${id}`).send({ nombreCompleto: "Nombre Cambiado" }),
            await yo.agente.patch(`/usuarios/${id}`).send({ rol: "GESTOR" }),
            await yo.agente.post(`/usuarios/${id}/restablecer-clave`),
          ]) {
            expect(res.status, nombre).toBe(404);
            expect(res.body.errorCode).toBe("NOT_FOUND");
            expect(res.body.message).toBe(esperado.message);
          }
          const [despues] = await contexto.database.query<{ activo: boolean; nombre: string; hash: string }>(
            "SELECT activo, nombre_completo AS nombre, password_hash AS hash FROM gestion.usuario_interno WHERE id = $1",
            [id],
          );
          expect(despues).toMatchObject({ activo: true, hash: (fila as { hash: string }).hash });
          expect(despues?.nombre).not.toBe("Nombre Cambiado");
          // Su sesión sigue abierta: no se tocó nada.
          expect((await ajeno.agente.get("/auth/me")).status).toBe(200);
        }
        expect((await yo.agente.patch("/usuarios/no-es-un-id").send({ activo: false })).status).toBe(404);
      });
    });
  });

  describe("escalada de privilegios imposible", () => {
    it("el responsable no se cambia el rol ni se desactiva (409 AUTOEDICION_NO_PERMITIDA) ni sube a nadie a administrador u OTRANS (403) ni mueve a nadie de área (403)", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const mia = await crearEstablecimientoDePrueba(contexto);
        const ajena = await crearEstablecimientoDePrueba(contexto);
        const yo = await entrar(contexto, app, [R.ESTABLECIMIENTO], mia);
        const colega = await crear(yo.agente, { rol: "GESTOR" });
        const miId = (await listar(yo.agente)).find((u) => u.correo === yo.correo)?.id as string;
        const idColega = colega.body.usuario.id as string;

        for (const cuerpo of [{ activo: false }, { rol: "GESTOR" }]) {
          const res = await yo.agente.patch(`/usuarios/${miId}`).send(cuerpo);
          expect(res.status, JSON.stringify(cuerpo)).toBe(409);
          expect(res.body.errorCode).toBe("AUTOEDICION_NO_PERMITIDA");
        }
        for (const id of [miId, idColega]) {
          for (const rol of ["ADMINISTRADOR", "OTRANS"]) {
            const res = await yo.agente.patch(`/usuarios/${id}`).send({ rol });
            expect(res.status, rol).toBe(403);
            expect(res.body.errorCode).toBe("FORBIDDEN");
          }
          expect((await yo.agente.patch(`/usuarios/${id}`).send({ area: ajena.areaCodigo })).status).toBe(403);
          expect((await yo.agente.patch(`/usuarios/${id}`).send({ area: "OTRANS" })).status).toBe(403);
        }
        const roles = await contexto.database.query<{ correo: string; rol: string }>(
          `SELECT u.correo, r.codigo AS rol FROM gestion.usuario_interno u
             JOIN gestion.usuario_rol ur ON ur.usuario_interno_id = u.id JOIN gestion.rol r ON r.id = ur.rol_id
            WHERE u.correo = ANY($1)`,
          [[yo.correo, colega.body.usuario.correo]],
        );
        expect(roles.sort((x, y) => x.rol.localeCompare(y.rol))).toEqual([
          { correo: yo.correo, rol: "ESTABLECIMIENTO" },
          { correo: colega.body.usuario.correo, rol: "GESTOR" },
        ].sort((x, y) => x.rol.localeCompare(y.rol)));
        expect((await yo.agente.get("/auth/me")).status).toBe(200);
      });
    });

    it("el responsable sí puede cambiar el nombre y el rol (entre gestor y establecimiento) de un colega, y reenviar su misma área", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const mia = await crearEstablecimientoDePrueba(contexto);
        const yo = await entrar(contexto, app, [R.ESTABLECIMIENTO], mia);
        const colega = await crear(yo.agente, { rol: "GESTOR" });
        const res = await yo.agente
          .patch(`/usuarios/${colega.body.usuario.id}`)
          .send({ nombreCompleto: "Nombre Corregido", rol: "ESTABLECIMIENTO", area: mia.areaCodigo });
        expect(res.status).toBe(200);
        expect(res.body.usuario).toMatchObject({ nombreCompleto: "Nombre Corregido", rol: "ESTABLECIMIENTO", area: { codigo: mia.areaCodigo } });
      });
    });

    it("el administrador tampoco se cambia el rol ni se desactiva a sí mismo", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const miId = (await listar(agente, { q: correo })).find((u) => u.correo === correo)?.id as string;
        expect((await agente.patch(`/usuarios/${miId}`).send({ activo: false })).body.errorCode).toBe("AUTOEDICION_NO_PERMITIDA");
        expect((await agente.patch(`/usuarios/${miId}`).send({ rol: "GESTOR", area: eess.areaCodigo })).body.errorCode).toBe("AUTOEDICION_NO_PERMITIDA");
        expect((await agente.get("/auth/me")).status).toBe(200);
      });
    });

    it("un cuerpo con campos de más no cambia el correo ni la huella", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], eess);
        const colega = await crear(agente, { rol: "GESTOR" });
        const id = colega.body.usuario.id as string;
        const [antes] = await contexto.database.query<{ hash: string }>("SELECT password_hash AS hash FROM gestion.usuario_interno WHERE id = $1", [id]);
        const res = await agente.patch(`/usuarios/${id}`).send({ nombreCompleto: "Nombre Nuevo", correo: "otro@minsa.gob.pe", password: "x".repeat(20), password_hash: "$argon2id$x" });
        expect(res.status).toBe(200);
        expect(res.body.usuario.correo).toBe(colega.body.usuario.correo);
        const [despues] = await contexto.database.query<{ hash: string }>("SELECT password_hash AS hash FROM gestion.usuario_interno WHERE id = $1", [id]);
        expect(despues?.hash).toBe(antes?.hash);
        expect((await agente.patch(`/usuarios/${id}`).send({ correo: "otro@minsa.gob.pe" })).status).toBe(400);
      });
    });
  });

  describe("cambios del administrador", () => {
    it("cambia el área de un gestor entre establecimientos y el rol con su área, y no deja un rol en un área de otro tipo", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);
        const gestor = await crear(agente, { rol: "GESTOR", area: a.areaCodigo });
        const id = gestor.body.usuario.id as string;

        const aOtroEess = await agente.patch(`/usuarios/${id}`).send({ area: b.areaCodigo });
        expect(aOtroEess.status).toBe(200);
        expect(aOtroEess.body.usuario.area).toEqual({ codigo: b.areaCodigo, nombre: b.areaNombre });

        expect((await agente.patch(`/usuarios/${id}`).send({ area: "OTRANS" })).status).toBe(422);
        expect((await agente.patch(`/usuarios/${id}`).send({ area: "EESS-NO-EXISTE" })).status).toBe(422);
        expect((await agente.patch(`/usuarios/${id}`).send({ rol: "OTRANS" })).status).toBe(422);

        const aOtrans = await agente.patch(`/usuarios/${id}`).send({ rol: "OTRANS", area: "OTRANS" });
        expect(aOtrans.status).toBe(200);
        expect(aOtrans.body.usuario).toMatchObject({ rol: "OTRANS", area: { codigo: "OTRANS" } });

        const aAdmin = await agente.patch(`/usuarios/${id}`).send({ rol: "ADMINISTRADOR" });
        expect(aAdmin.status).toBe(200);
        expect(aAdmin.body.usuario).toMatchObject({ rol: "ADMINISTRADOR", area: null });
        const roles = await contexto.database.query<{ rol: string }>(
          "SELECT r.codigo AS rol FROM gestion.usuario_rol ur JOIN gestion.rol r ON r.id = ur.rol_id WHERE ur.usuario_interno_id = $1",
          [id],
        );
        expect(roles).toEqual([{ rol: "ADMINISTRADOR" }]);
      });
    });

    it("desactivar no borra: marca quién y cuándo, y reactivar lo limpia", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente, correo } = await entrar(contexto, construir(contexto), [R.ADMINISTRADOR]);
        const gestor = await crear(agente, { rol: "GESTOR", area: eess.areaCodigo });
        const id = gestor.body.usuario.id as string;
        const leer = async () =>
          (await contexto.database.query<{ activo: boolean; eliminado_por: string | null; eliminado_en: Date | null }>(
            "SELECT activo, eliminado_por, eliminado_en FROM gestion.usuario_interno WHERE id = $1",
            [id],
          ))[0];

        expect((await agente.patch(`/usuarios/${id}`).send({ activo: false })).body.usuario.activo).toBe(false);
        const desactivado = await leer();
        expect(desactivado).toMatchObject({ activo: false, eliminado_por: `usuario:${correo}` });
        expect(desactivado?.eliminado_en).toBeInstanceOf(Date);
        expect((await listar(agente, { q: gestor.body.usuario.correo }))[0]).toMatchObject({ activo: false });

        expect((await agente.patch(`/usuarios/${id}`).send({ activo: true })).body.usuario.activo).toBe(true);
        expect(await leer()).toEqual({ activo: true, eliminado_por: null, eliminado_en: null });
      });
    });
  });

  describe("sesiones", () => {
    async function conSesion(app: ReturnType<typeof construir>, quien: AgentePrueba, rol: string, area: string) {
      const creado = await crear(quien, { rol, area });
      const clave = creado.body.claveInicial as string;
      const correo = creado.body.usuario.correo as string;
      const sesion = await loginConClave(app, correo, clave);
      expect(sesion.status).toBe(204);
      const cookie = sesion.headers["set-cookie"] as unknown as string[];
      expect(await estadoDeSesion(app, cookie)).toBe(200);
      return { id: creado.body.usuario.id as string, correo, clave, cookie };
    }

    it("desactivar, cambiar el rol o el área y restablecer la clave cierran las sesiones del usuario", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const a = await crearEstablecimientoDePrueba(contexto);
        const b = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ADMINISTRADOR]);

        const desactivado = await conSesion(app, agente, "GESTOR", a.areaCodigo);
        await agente.patch(`/usuarios/${desactivado.id}`).send({ activo: false });
        expect(await estadoDeSesion(app, desactivado.cookie)).toBe(401);
        expect((await loginConClave(app, desactivado.correo, desactivado.clave)).status).toBe(401);

        const conOtroRol = await conSesion(app, agente, "GESTOR", a.areaCodigo);
        await agente.patch(`/usuarios/${conOtroRol.id}`).send({ rol: "ESTABLECIMIENTO" });
        expect(await estadoDeSesion(app, conOtroRol.cookie)).toBe(401);
        const reingreso = request.agent(app);
        await reingreso.post("/auth/login").send({ correo: conOtroRol.correo, password: conOtroRol.clave });
        expect((await reingreso.get("/auth/me")).body.roles).toEqual(["ESTABLECIMIENTO"]);

        const conOtraArea = await conSesion(app, agente, "GESTOR", a.areaCodigo);
        await agente.patch(`/usuarios/${conOtraArea.id}`).send({ area: b.areaCodigo });
        expect(await estadoDeSesion(app, conOtraArea.cookie)).toBe(401);

        const sinCambios = await conSesion(app, agente, "GESTOR", b.areaCodigo);
        await agente.patch(`/usuarios/${sinCambios.id}`).send({ nombreCompleto: "Solo Cambia El Nombre" });
        expect(await estadoDeSesion(app, sinCambios.cookie)).toBe(200);

        const restablecida = await conSesion(app, agente, "GESTOR", b.areaCodigo);
        const reset = await agente.post(`/usuarios/${restablecida.id}/restablecer-clave`);
        expect(reset.status).toBe(200);
        expect(reset.headers["cache-control"]).toBe("no-store");
        expect(Object.keys(reset.body).sort()).toEqual(["claveInicial", "usuario"]);
        expect(await estadoDeSesion(app, restablecida.cookie)).toBe(401);
        expect((await loginConClave(app, restablecida.correo, restablecida.clave)).status).toBe(401);
        expect(reset.body.claveInicial).not.toBe(restablecida.clave);
        expect((await loginConClave(app, restablecida.correo, reset.body.claveInicial)).status).toBe(204);
      });
    });

    it("el responsable restablece la clave de un colega de su establecimiento, y la huella de la base cambia sin contener la clave", async () => {
      await usar(async (contexto) => {
        const app = construir(contexto);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const yo = await entrar(contexto, app, [R.ESTABLECIMIENTO], eess);
        const colega = await crear(yo.agente, { rol: "GESTOR" });
        const id = colega.body.usuario.id as string;
        const leerHuella = async () => (await contexto.database.query<{ hash: string }>("SELECT password_hash AS hash FROM gestion.usuario_interno WHERE id = $1", [id]))[0]?.hash as string;
        const antes = await leerHuella();

        const reset = await yo.agente.post(`/usuarios/${id}/restablecer-clave`);
        expect(reset.status).toBe(200);
        const despues = await leerHuella();
        expect(despues).not.toBe(antes);
        expect(despues.startsWith("$argon2id$")).toBe(true);
        expect(despues).not.toContain(reset.body.claveInicial);
        const [firma] = await contexto.database.query<{ usuario_modificacion: string }>("SELECT usuario_modificacion FROM gestion.usuario_interno WHERE id = $1", [id]);
        expect(firma?.usuario_modificacion).toBe(`usuario:${yo.correo}`);
      });
    });
  });

  describe("la clave no se filtra", () => {
    it("ni los logs de las peticiones (con la clave y con errores) ni la auditoría de los casos contienen la clave ni la huella", async () => {
      await usar(async (contexto) => {
        const lineas: string[] = [];
        const logger = createLogger(testEnv({ LOG_LEVEL: "trace" }), { write: (linea: string) => void lineas.push(linea) });
        const app = createApp(testEnv({ LOG_LEVEL: "trace" }), contexto.database, logger);
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, app, [R.ESTABLECIMIENTO], eess);

        const claves: string[] = [];
        const creado = await crear(agente, { rol: "GESTOR" });
        claves.push(creado.body.claveInicial);
        claves.push((await agente.post(`/usuarios/${creado.body.usuario.id}/restablecer-clave`)).body.claveInicial);
        await crear(agente, { rol: "GESTOR", correo: creado.body.usuario.correo });
        await crear(agente, { rol: "ADMINISTRADOR" });
        await agente.post("/usuarios").send({ nombreCompleto: "X", correo: "no", rol: "GESTOR" });
        await agente.patch(`/usuarios/${randomUUID()}`).send({ activo: false });
        await agente.get("/usuarios");
        const huellas = (
          await contexto.database.query<{ hash: string }>("SELECT password_hash AS hash FROM gestion.usuario_interno WHERE id = $1", [creado.body.usuario.id])
        ).map((f) => f.hash);

        expect(claves).toHaveLength(2);
        expect(lineas.length).toBeGreaterThan(0);
        const registro = lineas.join("");
        for (const secreto of [...claves, ...huellas]) expect(registro).not.toContain(secreto);
        expect(registro).not.toContain("argon2id");
        expect(registro).not.toContain("claveInicial");

        // La auditoría de los casos tampoco guarda nada de esto (y los usuarios no tienen una propia con la huella).
        const auditoria = await contexto.database.query<{ cambios: string }>("SELECT cambios::text AS cambios FROM chatbot.incidencia_paciente_auditoria LIMIT 1000");
        for (const fila of auditoria) {
          expect(fila.cambios).not.toContain("argon2id");
          for (const clave of claves) expect(fila.cambios).not.toContain(clave);
        }
      });
    });

    it("los errores de validación y de la base no repiten la clave ni la huella", async () => {
      await usar(async (contexto) => {
        const eess = await crearEstablecimientoDePrueba(contexto);
        const { agente } = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO], eess);
        const repetido = await crear(agente, { rol: "GESTOR" });
        const errores = [
          await crear(agente, { rol: "GESTOR", correo: repetido.body.usuario.correo }),
          await agente.post("/usuarios").send({ nombreCompleto: "Ana Quispe", correo: "mal", rol: "GESTOR", password: "una-clave-que-no-debe-repetirse" }),
          await agente.patch(`/usuarios/${repetido.body.usuario.id}`).send({ rol: "ADMINISTRADOR", password: "una-clave-que-no-debe-repetirse" }),
        ];
        for (const error of errores) {
          const texto = JSON.stringify(error.body);
          expect(texto).not.toContain("argon2");
          expect(texto).not.toContain("una-clave-que-no-debe-repetirse");
          expect(texto).not.toContain("claveInicial");
        }
      });
    });
  });
});
