import { describe, expect, it, vi } from "vitest";
import { RolCodigo as R } from "@/enums/rol-codigo.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import type { FilaUsuarioGestion, UsuarioGestionRepository } from "@/repositories/usuario-gestion.repository.js";
import type { SesionActual } from "@/services/auth.types.js";
import { UsuarioService } from "@/services/usuario.service.js";
import { createFakeDatabase } from "@/test-utils/fake-database.js";
import { decodificarCursorDeUsuarios } from "@/utils/cursor-usuarios.js";
import type { PasswordHasher } from "@/utils/password-hasher.js";

const HUELLA = "$argon2id$huella-de-prueba";
const AREA_PROPIA = { id: 7, codigo: "EESS-9001", nombre: "Centro de Salud Uno", tipo: "ESTABLECIMIENTO" as const };

const sesion = (roles: string[], area: SesionActual["area"], usuarioId = "yo"): SesionActual => ({
  sesionId: "s1",
  usuarioId,
  correo: "quien.actua@minsa.gob.pe",
  nombreCompleto: "Quien Actúa",
  roles,
  area,
  vistas: [VistaCodigo.USUARIOS],
});
const responsable = sesion([R.ESTABLECIMIENTO], AREA_PROPIA);
const admin = sesion([R.ADMINISTRADOR], null);

const fila = (cambios: Partial<FilaUsuarioGestion> = {}): FilaUsuarioGestion => ({
  id: "u-1",
  nombreCompleto: "Ana Quispe",
  correo: "ana@minsa.gob.pe",
  activo: true,
  rol: R.GESTOR,
  areaId: 7,
  areaCodigo: "EESS-9001",
  areaNombre: "Centro de Salud Uno",
  ...cambios,
});

function montar(existente: FilaUsuarioGestion | null = fila()) {
  const llamadas: string[] = [];
  const registrar =
    <T>(nombre: string, resultado: T) =>
    async (..._args: unknown[]): Promise<T> => {
      llamadas.push(nombre);
      return resultado;
    };
  const repo = {
    listar: vi.fn(async () => [] as FilaUsuarioGestion[]),
    buscarPorId: vi.fn(async () => existente),
    areaActiva: vi.fn(async () => 9 as number | null),
    crear: vi.fn(registrar("crear", "u-nuevo")),
    asignarRol: vi.fn(registrar("asignarRol", undefined)),
    quitarRoles: vi.fn(registrar("quitarRoles", undefined)),
    cambiarArea: vi.fn(registrar("cambiarArea", undefined)),
    cambiarNombre: vi.fn(registrar("cambiarNombre", undefined)),
    cambiarVigencia: vi.fn(registrar("cambiarVigencia", undefined)),
    cambiarClave: vi.fn(registrar("cambiarClave", undefined)),
    cerrarSesiones: vi.fn(registrar("cerrarSesiones", undefined)),
  };
  const hasher: PasswordHasher = { hash: vi.fn(async () => HUELLA), verify: vi.fn(async () => true) };
  const actores: string[] = [];
  const database = createFakeDatabase({
    transaction: vi.fn(async (actor: string, work: Parameters<ReturnType<typeof createFakeDatabase>["transaction"]>[1]) => {
      actores.push(actor);
      return work({ query: vi.fn(async () => []) });
    }) as never,
  });
  const servicio = new UsuarioService(repo as unknown as UsuarioGestionRepository, database, hasher);
  return { servicio, repo, hasher, llamadas, actores };
}

describe("UsuarioService", () => {
  describe("quién puede gestionar usuarios", () => {
    it.each([[[R.GESTOR]], [[R.OTRANS]], [[]], [["INVENTADO"]]])("%j no puede listar, crear, editar ni restablecer (403)", async (roles) => {
      const { servicio, repo } = montar();
      const persona = sesion(roles, AREA_PROPIA);
      const prohibido = { statusCode: 403, errorCode: "FORBIDDEN" };
      await expect(servicio.listar(persona, { limite: 10 })).rejects.toMatchObject(prohibido);
      await expect(servicio.crear(persona, { nombreCompleto: "X Y Z", correo: "x@minsa.gob.pe", rol: R.GESTOR })).rejects.toMatchObject(prohibido);
      await expect(servicio.actualizar(persona, "u-1", { activo: false })).rejects.toMatchObject(prohibido);
      await expect(servicio.restablecerClave(persona, "u-1")).rejects.toMatchObject(prohibido);
      expect(repo.listar).not.toHaveBeenCalled();
      expect(repo.crear).not.toHaveBeenCalled();
    });
  });

  describe("listar", () => {
    it("el responsable solo ve su área, aunque pida otra", async () => {
      const { servicio, repo } = montar();
      await servicio.listar(responsable, { limite: 10, area: "EESS-OTRO", texto: "ana" });
      expect(repo.listar).toHaveBeenCalledWith({ texto: "ana", soloAreaId: 7 }, 11, null);
    });

    it("un responsable sin área no ve ningún usuario", async () => {
      const { servicio, repo } = montar();
      await servicio.listar(sesion([R.ESTABLECIMIENTO], null), { limite: 10 });
      expect(repo.listar).toHaveBeenCalledWith({ soloAreaId: null }, 11, null);
    });

    it("el administrador ve todas las áreas y puede filtrar por una", async () => {
      const { servicio, repo } = montar();
      await servicio.listar(admin, { limite: 10 });
      expect(repo.listar).toHaveBeenLastCalledWith({}, 11, null);
      await servicio.listar(admin, { limite: 10, area: "EESS-9001" });
      expect(repo.listar).toHaveBeenLastCalledWith({ areaCodigo: "EESS-9001" }, 11, null);
    });

    it("pide uno de más para saber si hay otra página y arma el cursor con el último entregado", async () => {
      const { servicio, repo } = montar();
      repo.listar.mockResolvedValueOnce([
        fila({ id: "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a01", nombreCompleto: "Ana" }),
        fila({ id: "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a02", nombreCompleto: "Beto" }),
        fila({ id: "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a03", nombreCompleto: "Carla" }),
      ]);
      const pagina = await servicio.listar(admin, { limite: 2 });
      expect(pagina.items.map((u) => u.nombreCompleto)).toEqual(["Ana", "Beto"]);
      expect(pagina.hayMas).toBe(true);
      expect(decodificarCursorDeUsuarios(pagina.siguiente as string)).toEqual({ nombre: "Beto", id: "0199a2b4-7c3d-7e5f-8a9b-0c1d2e3f4a02" });

      repo.listar.mockResolvedValueOnce([fila()]);
      expect(await servicio.listar(admin, { limite: 2 })).toMatchObject({ siguiente: null, hayMas: false });
    });

    it("el usuario sale sin id de área, sin huella y con el área como código y nombre", async () => {
      const { servicio, repo } = montar();
      repo.listar.mockResolvedValueOnce([fila()]);
      const [item] = (await servicio.listar(admin, { limite: 10 })).items;
      expect(item).toEqual({
        id: "u-1", nombreCompleto: "Ana Quispe", correo: "ana@minsa.gob.pe", rol: "GESTOR", activo: true,
        area: { codigo: "EESS-9001", nombre: "Centro de Salud Uno" },
      });
    });
  });

  describe("crear", () => {
    const datos = { nombreCompleto: "Ana Quispe", correo: "ana@minsa.gob.pe" };

    it("el responsable crea siempre en su área, tomada de la sesión, e ignora el área del cuerpo", async () => {
      const { servicio, repo } = montar();
      await servicio.crear(responsable, { ...datos, rol: R.GESTOR, area: "EESS-AJENA" });
      expect(repo.areaActiva).not.toHaveBeenCalled();
      expect(repo.crear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ areaId: 7 }));
    });

    it.each([R.ADMINISTRADOR, R.OTRANS])("el responsable no puede asignar el rol %s (403)", async (rol) => {
      const { servicio, repo } = montar();
      await expect(servicio.crear(responsable, { ...datos, rol })).rejects.toMatchObject({ statusCode: 403, errorCode: "FORBIDDEN" });
      expect(repo.crear).not.toHaveBeenCalled();
    });

    it("el responsable sin área no puede crear (403)", async () => {
      const { servicio, repo } = montar();
      await expect(servicio.crear(sesion([R.ESTABLECIMIENTO], null), { ...datos, rol: R.GESTOR })).rejects.toMatchObject({ statusCode: 403 });
      expect(repo.crear).not.toHaveBeenCalled();
    });

    it("la clave la genera el sistema, se hashea y solo la huella llega a la base; la clave vuelve una sola vez", async () => {
      const { servicio, repo, hasher } = montar();
      const { usuario, claveInicial } = await servicio.crear(responsable, { ...datos, rol: R.GESTOR });
      expect(claveInicial).toHaveLength(20);
      expect(hasher.hash).toHaveBeenCalledExactlyOnceWith(claveInicial);
      const [, enviado] = repo.crear.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(enviado).toMatchObject({ huella: HUELLA, correo: "ana@minsa.gob.pe", nombreCompleto: "Ana Quispe" });
      expect(JSON.stringify(enviado)).not.toContain(claveInicial);
      expect(JSON.stringify(usuario)).not.toContain(claveInicial);
      expect(JSON.stringify(usuario)).not.toContain("argon2");
    });

    it("dos usuarios nunca reciben la misma clave", async () => {
      const { servicio } = montar();
      const claves = new Set<string>();
      for (let i = 0; i < 20; i += 1) claves.add((await servicio.crear(responsable, { ...datos, rol: R.GESTOR })).claveInicial);
      expect(claves.size).toBe(20);
    });

    it("la creación se firma con el usuario que crea", async () => {
      const { servicio, actores } = montar();
      await servicio.crear(responsable, { ...datos, rol: R.GESTOR });
      expect(actores).toEqual(["usuario:quien.actua@minsa.gob.pe"]);
    });

    it("el administrador indica el área, que debe existir y estar activa", async () => {
      const { servicio, repo } = montar();
      await servicio.crear(admin, { ...datos, rol: R.OTRANS, area: "OTRANS" });
      expect(repo.areaActiva).toHaveBeenCalledWith("OTRANS", expect.anything());
      expect(repo.crear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ areaId: 9 }));

      repo.areaActiva.mockResolvedValueOnce(null);
      await expect(servicio.crear(admin, { ...datos, rol: R.GESTOR, area: "NO-EXISTE" })).rejects.toMatchObject({ statusCode: 422, errorCode: "UNPROCESSABLE" });
    });

    it.each([R.GESTOR, R.ESTABLECIMIENTO, R.OTRANS])("el administrador debe indicar el área para %s (422)", async (rol) => {
      const { servicio, repo } = montar();
      await expect(servicio.crear(admin, { ...datos, rol })).rejects.toMatchObject({ statusCode: 422, errorCode: "UNPROCESSABLE" });
      expect(repo.crear).not.toHaveBeenCalled();
    });

    it("el administrador nuevo no lleva área, y indicarla es un error (422)", async () => {
      const { servicio, repo } = montar();
      await expect(servicio.crear(admin, { ...datos, rol: R.ADMINISTRADOR, area: "OTRANS" })).rejects.toMatchObject({ statusCode: 422 });
      expect(repo.crear).not.toHaveBeenCalled();
      await servicio.crear(admin, { ...datos, rol: R.ADMINISTRADOR });
      expect(repo.crear).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ areaId: null }));
    });

    it("un correo repetido es un 409 CORREO_REPETIDO y no revela la clave", async () => {
      const { servicio, repo } = montar();
      repo.crear.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "uq_usuario_interno_correo" }));
      const error = await servicio.crear(responsable, { ...datos, rol: R.GESTOR }).catch((e: unknown) => e);
      expect(error).toMatchObject({ statusCode: 409, errorCode: "CORREO_REPETIDO", message: "Ya existe un usuario con ese correo." });
    });

    it("otra violación de unicidad no se confunde con un correo repetido", async () => {
      const { servicio, repo } = montar();
      repo.crear.mockRejectedValueOnce(Object.assign(new Error("duplicate key"), { code: "23505", constraint: "otra_restriccion" }));
      const error = await servicio.crear(responsable, { ...datos, rol: R.GESTOR }).catch((e: unknown) => e);
      expect(error).not.toMatchObject({ errorCode: "CORREO_REPETIDO" });
    });

    it("el tope de 3 usuarios activos de la base es un 409 LIMITE_USUARIOS_ESTABLECIMIENTO", async () => {
      const { servicio, repo } = montar();
      repo.crear.mockRejectedValueOnce(
        Object.assign(new Error("usuario_interno: el establecimiento ya tiene 3 usuarios activos"), { code: "23514" }),
      );
      const error = await servicio.crear(responsable, { ...datos, rol: R.GESTOR }).catch((e: unknown) => e);
      expect(error).toMatchObject({ statusCode: 409, errorCode: "LIMITE_USUARIOS_ESTABLECIMIENTO" });
      expect((error as Error).message).not.toContain("usuario_interno");
    });
  });

  describe("actualizar", () => {
    it("un usuario fuera del alcance es un 404 (el responsable solo alcanza su área)", async () => {
      const { servicio, repo } = montar(null);
      await expect(servicio.actualizar(responsable, "u-ajeno", { activo: false })).rejects.toMatchObject({ statusCode: 404, errorCode: "NOT_FOUND" });
      expect(repo.buscarPorId).toHaveBeenCalledWith("u-ajeno", 7, expect.anything(), true);
    });

    it("el administrador busca sin límite de área", async () => {
      const { servicio, repo } = montar();
      await servicio.actualizar(admin, "u-1", { nombreCompleto: "Ana Quispe Diaz" });
      expect(repo.buscarPorId).toHaveBeenNthCalledWith(1, "u-1", undefined, expect.anything(), true);
    });

    it("nadie cambia su propio rol ni se desactiva a sí mismo (409), pero sí su nombre o reenviar el mismo rol", async () => {
      const yo = fila({ id: "yo", rol: R.ESTABLECIMIENTO });
      const { servicio, repo } = montar(yo);
      for (const cambios of [{ activo: false }, { rol: R.GESTOR }]) {
        await expect(servicio.actualizar(responsable, "yo", cambios)).rejects.toMatchObject({ statusCode: 409, errorCode: "AUTOEDICION_NO_PERMITIDA" });
      }
      expect(repo.quitarRoles).not.toHaveBeenCalled();
      expect(repo.cambiarVigencia).not.toHaveBeenCalled();
      await servicio.actualizar(responsable, "yo", { nombreCompleto: "Otro Nombre", rol: R.ESTABLECIMIENTO, activo: true });
      expect(repo.cambiarNombre).toHaveBeenCalled();
      expect(repo.quitarRoles).not.toHaveBeenCalled();
    });

    it("el responsable no puede subir a nadie a administrador ni a OTRANS (403, escalada de privilegios)", async () => {
      const { servicio, repo } = montar();
      for (const rol of [R.ADMINISTRADOR, R.OTRANS]) {
        await expect(servicio.actualizar(responsable, "u-1", { rol })).rejects.toMatchObject({ statusCode: 403, errorCode: "FORBIDDEN" });
      }
      expect(repo.quitarRoles).not.toHaveBeenCalled();
      expect(repo.asignarRol).not.toHaveBeenCalled();
    });

    it("el responsable no mueve a nadie de área (403), pero puede reenviar la que ya tiene", async () => {
      const { servicio, repo } = montar();
      await expect(servicio.actualizar(responsable, "u-1", { area: "EESS-AJENA" })).rejects.toMatchObject({ statusCode: 403 });
      expect(repo.cambiarArea).not.toHaveBeenCalled();
      await servicio.actualizar(responsable, "u-1", { area: "EESS-9001", nombreCompleto: "Ana Quispe Diaz" });
      expect(repo.cambiarArea).not.toHaveBeenCalled();
      expect(repo.areaActiva).not.toHaveBeenCalled();
    });

    it("cambiar de rol retira el rol, asigna el nuevo y cierra las sesiones, en ese orden", async () => {
      const { servicio, llamadas } = montar(fila({ rol: R.GESTOR }));
      await servicio.actualizar(responsable, "u-1", { rol: R.ESTABLECIMIENTO });
      expect(llamadas).toEqual(["quitarRoles", "asignarRol", "cerrarSesiones"]);
    });

    it("mover de área lo hace solo el administrador y no cierra las sesiones a mano (lo hace un disparador de la base)", async () => {
      const { servicio, repo, llamadas } = montar();
      await servicio.actualizar(admin, "u-1", { area: "EESS-0002" });
      expect(repo.areaActiva).toHaveBeenCalledWith("EESS-0002", expect.anything());
      expect(llamadas).toEqual(["cambiarArea"]);
      expect(repo.cambiarArea).toHaveBeenCalledWith(expect.anything(), "u-1", 9);
    });

    it("pasar de gestor a OTRANS retira el rol, mueve el área y asigna el rol nuevo, en ese orden", async () => {
      const { servicio, llamadas } = montar(fila({ rol: R.GESTOR }));
      await servicio.actualizar(admin, "u-1", { rol: R.OTRANS, area: "OTRANS" });
      expect(llamadas).toEqual(["quitarRoles", "cambiarArea", "asignarRol", "cerrarSesiones"]);
    });

    it("cambiar a un rol de área sin indicar el área de quien no tiene (administrador) es un 422", async () => {
      const { servicio, repo } = montar(fila({ rol: R.ADMINISTRADOR, areaId: null, areaCodigo: null, areaNombre: null }));
      await expect(servicio.actualizar(admin, "u-1", { rol: R.GESTOR })).rejects.toMatchObject({ statusCode: 422 });
      expect(repo.quitarRoles).not.toHaveBeenCalled();
    });

    it("pasar a administrador le quita el área, y indicarla es un 422", async () => {
      const { servicio, repo } = montar(fila({ rol: R.GESTOR }));
      await expect(servicio.actualizar(admin, "u-1", { rol: R.ADMINISTRADOR, area: "OTRANS" })).rejects.toMatchObject({ statusCode: 422 });
      await servicio.actualizar(admin, "u-1", { rol: R.ADMINISTRADOR });
      expect(repo.cambiarArea).toHaveBeenCalledWith(expect.anything(), "u-1", null);
    });

    it("desactivar no borra: marca la vigencia con el actor, y la base cierra las sesiones", async () => {
      const { servicio, repo, llamadas } = montar();
      await servicio.actualizar(responsable, "u-1", { activo: false });
      expect(repo.cambiarVigencia).toHaveBeenCalledWith(expect.anything(), "u-1", false, "usuario:quien.actua@minsa.gob.pe");
      expect(llamadas).toEqual(["cambiarVigencia"]);
    });

    it("no escribe nada si los cambios no cambian nada", async () => {
      const { servicio, llamadas } = montar();
      await servicio.actualizar(responsable, "u-1", { nombreCompleto: "Ana Quispe", activo: true, rol: R.GESTOR });
      expect(llamadas).toEqual([]);
    });

    it("el tope de 3 al reactivar o mover es un 409 LIMITE_USUARIOS_ESTABLECIMIENTO", async () => {
      const { servicio, repo } = montar(fila({ activo: false }));
      repo.cambiarVigencia.mockRejectedValueOnce(
        Object.assign(new Error("usuario_interno: el establecimiento ya tiene 3 usuarios activos"), { code: "23514" }),
      );
      await expect(servicio.actualizar(responsable, "u-1", { activo: true })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "LIMITE_USUARIOS_ESTABLECIMIENTO",
      });
    });
  });

  describe("restablecerClave", () => {
    it("un usuario fuera del alcance es un 404 y no cambia ninguna clave", async () => {
      const { servicio, repo, hasher } = montar(null);
      await expect(servicio.restablecerClave(responsable, "u-ajeno")).rejects.toMatchObject({ statusCode: 404 });
      expect(repo.cambiarClave).not.toHaveBeenCalled();
      expect(hasher.hash).toHaveBeenCalledTimes(1);
    });

    it("guarda solo la huella, cierra las sesiones y devuelve la clave una sola vez", async () => {
      const { servicio, repo, hasher, llamadas } = montar();
      const { usuario, claveInicial } = await servicio.restablecerClave(responsable, "u-1");
      expect(claveInicial).toHaveLength(20);
      expect(hasher.hash).toHaveBeenCalledExactlyOnceWith(claveInicial);
      expect(repo.cambiarClave).toHaveBeenCalledWith(expect.anything(), "u-1", HUELLA);
      expect(llamadas).toEqual(["cambiarClave", "cerrarSesiones"]);
      expect(JSON.stringify(usuario)).not.toContain(claveInicial);
    });
  });
});
