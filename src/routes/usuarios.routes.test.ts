import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";
import { createUsuariosRouter } from "@/routes/usuarios.routes.js";
import type { SesionActual } from "@/services/auth.types.js";
import type { UsuarioServicio } from "@/services/usuario.types.js";
import { codificarCursorDeUsuarios } from "@/utils/cursor-usuarios.js";

const ID = "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a5b";
const CLAVE = "Zk7mNpQrStUvWxYz2345";
const USUARIO = { id: ID, nombreCompleto: "Ana Quispe", correo: "ana@minsa.gob.pe", rol: "GESTOR", activo: true, area: null };

const sesion: SesionActual = {
  sesionId: "s1",
  usuarioId: "u1",
  correo: "resp@minsa.gob.pe",
  nombreCompleto: "Responsable",
  roles: ["ESTABLECIMIENTO"],
  area: { id: 7, codigo: "EESS-9001", nombre: "Centro de Salud", tipo: "ESTABLECIMIENTO" },
  vistas: [VistaCodigo.USUARIOS],
};

function servicioFalso() {
  return {
    listar: vi.fn(async () => ({ items: [], siguiente: null, hayMas: false })),
    crear: vi.fn(async () => ({ usuario: USUARIO, claveInicial: CLAVE })),
    actualizar: vi.fn(async () => USUARIO),
    restablecerClave: vi.fn(async () => ({ usuario: USUARIO, claveInicial: CLAVE })),
  };
}

function montar(servicio: ReturnType<typeof servicioFalso>, actual: SesionActual | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (actual) req.sesion = actual;
    Object.assign(req, { log: { error: () => undefined } });
    next();
  });
  app.use(createUsuariosRouter(servicio as unknown as UsuarioServicio));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("rutas de usuarios", () => {
  let servicio: ReturnType<typeof servicioFalso>;
  beforeEach(() => {
    servicio = servicioFalso();
  });

  describe("acceso", () => {
    it("sin sesión responde 401 en todas las rutas", async () => {
      const app = montar(servicio, null);
      expect((await request(app).get("/usuarios")).status).toBe(401);
      expect((await request(app).post("/usuarios").send({})).status).toBe(401);
      expect((await request(app).patch(`/usuarios/${ID}`).send({ activo: false })).status).toBe(401);
      expect((await request(app).post(`/usuarios/${ID}/restablecer-clave`)).status).toBe(401);
      expect(servicio.listar).not.toHaveBeenCalled();
    });

    it("sin la vista de usuarios responde 403 y no llega al servicio", async () => {
      const app = montar(servicio, { ...sesion, vistas: [VistaCodigo.CASOS] });
      expect((await request(app).get("/usuarios")).status).toBe(403);
      expect((await request(app).post("/usuarios").send({})).status).toBe(403);
      expect((await request(app).patch(`/usuarios/${ID}`).send({ activo: false })).status).toBe(403);
      expect((await request(app).post(`/usuarios/${ID}/restablecer-clave`)).status).toBe(403);
      expect(servicio.listar).not.toHaveBeenCalled();
      expect(servicio.crear).not.toHaveBeenCalled();
    });
  });

  describe("GET /usuarios", () => {
    it("usa 50 por página, sin cursor ni filtros cuando no se piden", async () => {
      const res = await request(montar(servicio, sesion)).get("/usuarios");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], siguiente: null, hayMas: false });
      expect(servicio.listar).toHaveBeenCalledWith(sesion, { limite: 50 });
    });

    it("pasa el límite, la búsqueda, el área y el cursor ya validados y decodificados", async () => {
      const posicion = { nombre: "Ana Quispe", id: ID };
      await request(montar(servicio, sesion))
        .get("/usuarios")
        .query({ limite: "5", q: "  ana  ", area: " EESS-9001 ", cursor: codificarCursorDeUsuarios(posicion) });
      expect(servicio.listar).toHaveBeenCalledWith(sesion, { limite: 5, texto: "ana", area: "EESS-9001", despuesDe: posicion });
    });

    it.each([
      ["limite", "0"],
      ["limite", "201"],
      ["limite", "abc"],
      ["cursor", "no es un cursor"],
      ["cursor", "a".repeat(601)],
      ["q", "a".repeat(101)],
      ["area", "a".repeat(51)],
    ])("rechaza %s=%s con 400 y no llega al servicio", async (campo, valor) => {
      const res = await request(montar(servicio, sesion)).get("/usuarios").query({ [campo]: valor });
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      expect(servicio.listar).not.toHaveBeenCalled();
    });
  });

  describe("POST /usuarios", () => {
    const cuerpo = { nombreCompleto: "Ana Quispe", correo: "ana@minsa.gob.pe", rol: "GESTOR" };

    it("responde 201 con el usuario y la clave inicial, sin guardar en caché", async () => {
      const res = await request(montar(servicio, sesion)).post("/usuarios").send(cuerpo);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ usuario: USUARIO, claveInicial: CLAVE });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(servicio.crear).toHaveBeenCalledWith(sesion, cuerpo);
    });

    it("normaliza el correo (sin espacios, en minúsculas) y el nombre, y deja pasar el área", async () => {
      await request(montar(servicio, sesion))
        .post("/usuarios")
        .send({ nombreCompleto: "  Ana Quispe  ", correo: "  ANA@Minsa.GOB.pe ", rol: "OTRANS", area: " OTRANS ", activo: false, id: "x" });
      expect(servicio.crear).toHaveBeenCalledWith(sesion, { nombreCompleto: "Ana Quispe", correo: "ana@minsa.gob.pe", rol: "OTRANS", area: "OTRANS" });
    });

    it.each([
      ["sin cuerpo", {}],
      ["sin nombre", { correo: "ana@minsa.gob.pe", rol: "GESTOR" }],
      ["con nombre de espacios", { ...cuerpo, nombreCompleto: "      " }],
      ["con nombre demasiado corto", { ...cuerpo, nombreCompleto: "Al" }],
      ["con nombre demasiado largo", { ...cuerpo, nombreCompleto: "a".repeat(121) }],
      ["sin correo", { nombreCompleto: "Ana Quispe", rol: "GESTOR" }],
      ["con correo inválido", { ...cuerpo, correo: "no-es-correo" }],
      ["con correo demasiado largo", { ...cuerpo, correo: `${"a".repeat(250)}@minsa.gob.pe` }],
      ["sin rol", { nombreCompleto: "Ana Quispe", correo: "ana@minsa.gob.pe" }],
      ["con un rol que no existe", { ...cuerpo, rol: "SUPERUSUARIO" }],
      ["con el rol desactivado DIRIS", { ...cuerpo, rol: "DIRIS" }],
      ["con rol en minúsculas", { ...cuerpo, rol: "gestor" }],
      ["con área vacía", { ...cuerpo, area: "   " }],
      ["con área demasiado larga", { ...cuerpo, area: "a".repeat(51) }],
    ])("rechaza %s con 400 y no llega al servicio", async (_nombre, enviado) => {
      const res = await request(montar(servicio, sesion)).post("/usuarios").send(enviado);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      expect(servicio.crear).not.toHaveBeenCalled();
    });

    it("un error del servicio no devuelve la clave inicial", async () => {
      servicio.crear.mockRejectedValueOnce(Object.assign(new Error("falla"), { statusCode: 500 }));
      const res = await request(montar(servicio, sesion)).post("/usuarios").send(cuerpo);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain(CLAVE);
      expect(res.headers["cache-control"]).not.toBe("no-store");
    });
  });

  describe("PATCH /usuarios/:id", () => {
    it("pasa solo los campos conocidos y responde el usuario", async () => {
      const res = await request(montar(servicio, sesion))
        .patch(`/usuarios/${ID}`)
        .send({ nombreCompleto: "  Ana Quispe Diaz ", rol: "ESTABLECIMIENTO", activo: false, area: "EESS-9001", correo: "otro@minsa.gob.pe", password: "x" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ usuario: USUARIO });
      expect(servicio.actualizar).toHaveBeenCalledWith(sesion, ID, {
        nombreCompleto: "Ana Quispe Diaz",
        rol: "ESTABLECIMIENTO",
        activo: false,
        area: "EESS-9001",
      });
    });

    it("acepta un solo campo", async () => {
      await request(montar(servicio, sesion)).patch(`/usuarios/${ID}`).send({ activo: true });
      expect(servicio.actualizar).toHaveBeenCalledWith(sesion, ID, { activo: true });
    });

    it.each([
      ["sin ningún dato", {}],
      ["solo con campos desconocidos", { correo: "otro@minsa.gob.pe" }],
      ["con activo que no es booleano", { activo: "no" }],
      ["con un rol que no existe", { rol: "SUPERUSUARIO" }],
      ["con nombre corto", { nombreCompleto: "Al" }],
      ["con área vacía", { area: "" }],
    ])("rechaza %s con 400 y no llega al servicio", async (_nombre, enviado) => {
      const res = await request(montar(servicio, sesion)).patch(`/usuarios/${ID}`).send(enviado);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      expect(servicio.actualizar).not.toHaveBeenCalled();
    });

    it.each(["abc", "123", "0199A2B4-7C3D-7E5F-8A9B-0C1D2E3F4A5B", `${ID}%27`])("un id con forma inválida (%s) responde 404 sin llegar al servicio", async (id) => {
      const res = await request(montar(servicio, sesion)).patch(`/usuarios/${id}`).send({ activo: false });
      expect(res.status).toBe(404);
      expect(servicio.actualizar).not.toHaveBeenCalled();
    });
  });

  describe("POST /usuarios/:id/restablecer-clave", () => {
    it("responde la clave nueva una sola vez, sin guardar en caché", async () => {
      const res = await request(montar(servicio, sesion)).post(`/usuarios/${ID}/restablecer-clave`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ usuario: USUARIO, claveInicial: CLAVE });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(servicio.restablecerClave).toHaveBeenCalledWith(sesion, ID);
    });

    it("un id con forma inválida responde 404 sin llegar al servicio", async () => {
      const res = await request(montar(servicio, sesion)).post("/usuarios/abc/restablecer-clave");
      expect(res.status).toBe(404);
      expect(servicio.restablecerClave).not.toHaveBeenCalled();
    });
  });

  it("no existen DELETE ni PUT: desactivar es un PATCH con activo=false", async () => {
    const app = montar(servicio, sesion);
    expect((await request(app).delete(`/usuarios/${ID}`)).status).toBe(404);
    expect((await request(app).put(`/usuarios/${ID}`).send({ activo: false })).status).toBe(404);
  });
});
