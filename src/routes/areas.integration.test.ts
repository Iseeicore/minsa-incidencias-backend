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

interface AreaDto {
  id: number;
  codigo: string;
  nombre: string;
  tipoArea: string;
  establecimiento: { codigoRenipress: string; nivelAtencion: string | null; categoria: string | null } | null;
}

/** Palabra única solo con letras, para filtrar con `q` sin chocar con un padrón ya cargado. */
const marcaDeNombre = (): string => `Zq${randomUUID().replace(/[^a-f]/g, "")}`;

async function entrar(contexto: RollbackContext, app: ReturnType<typeof construir>, roles: string[], areaCodigo: string | null = null) {
  const correo = await crearUsuarioDePrueba(contexto, roles, undefined, undefined, areaCodigo);
  return iniciarSesion(app, correo);
}

const nombres = async (agente: AgentePrueba, consulta: Record<string, string>): Promise<string[]> => {
  const res = await agente.get("/areas").query(consulta);
  expect(res.status).toBe(200);
  return (res.body.items as AreaDto[]).map((area) => area.nombre);
};

describe.skipIf(!url)("áreas contra PostgreSQL real", () => {
  const usar = (prueba: (contexto: RollbackContext) => Promise<void>) => withRollbackDatabase(url as string, prueba);

  async function sembrar(contexto: RollbackContext, marca: string): Promise<EstablecimientoDePrueba[]> {
    const lista: EstablecimientoDePrueba[] = [];
    for (const nombre of [`${marca} Ñandú`, `${marca} Alfa`, `${marca} Beta`]) lista.push(await crearEstablecimientoDePrueba(contexto, nombre));
    return lista;
  }

  it("exige sesión y devuelve la forma del contrato, sin datos internos", async () => {
    await usar(async (contexto) => {
      const app = construir(contexto);
      expect((await request(app).get("/areas")).status).toBe(401);

      const marca = marcaDeNombre();
      const [nandu] = await sembrar(contexto, marca);
      await contexto.database.transaction("sistema:prueba", (tx) =>
        tx.query(
          "UPDATE catalogo.establecimiento_salud SET categoria = 'I-3', nivel_atencion_id = (SELECT id FROM catalogo.nivel_atencion WHERE codigo = 'I') WHERE id = $1",
          [(nandu as EstablecimientoDePrueba).establecimientoId],
        ),
      );
      const agente = await entrar(contexto, app, [R.GESTOR]);
      const res = await agente.get("/areas").query({ q: marca });
      expect(Object.keys(res.body).sort()).toEqual(["hayMas", "items", "siguiente"]);
      const area = (res.body.items as AreaDto[]).find((a) => a.id === (nandu as EstablecimientoDePrueba).areaId);
      expect(area).toEqual({
        id: (nandu as EstablecimientoDePrueba).areaId,
        codigo: (nandu as EstablecimientoDePrueba).areaCodigo,
        nombre: (nandu as EstablecimientoDePrueba).nombre,
        tipoArea: "ESTABLECIMIENTO",
        establecimiento: { codigoRenipress: (nandu as EstablecimientoDePrueba).codigoRenipress, nivelAtencion: "I", categoria: "I-3" },
      });
      expect(Object.keys(area as AreaDto).sort()).toEqual(["codigo", "establecimiento", "id", "nombre", "tipoArea"]);
    });
  });

  it("el gestor y el administrador listan todas; OTRANS y cada establecimiento, solo la suya", async () => {
    await usar(async (contexto) => {
      const app = construir(contexto);
      const marca = marcaDeNombre();
      const [a, b] = await sembrar(contexto, marca);
      const [ea, eb] = [a as EstablecimientoDePrueba, b as EstablecimientoDePrueba];

      for (const rol of [R.GESTOR, R.ADMINISTRADOR]) {
        const agente = await entrar(contexto, app, [rol]);
        expect(await nombres(agente, { q: marca })).toHaveLength(3);
      }
      const delA = await entrar(contexto, app, [R.ESTABLECIMIENTO], ea.areaCodigo);
      expect(await nombres(delA, { q: marca })).toEqual([ea.nombre]);
      expect(await nombres(delA, {})).toEqual([ea.nombre]);
      expect(await nombres(delA, { q: eb.nombre })).toEqual([]);
      expect(await nombres(delA, { tipo: "OTRANS" })).toEqual([]);

      const otrans = await entrar(contexto, app, [R.OTRANS], "OTRANS");
      const vistas = await nombres(otrans, {});
      expect(vistas).toEqual(["OTRANS"]);
      expect(await nombres(otrans, { tipo: "ESTABLECIMIENTO" })).toEqual([]);

      const res = await otrans.get("/areas");
      expect(res.body.items[0]).toMatchObject({ codigo: "OTRANS", tipoArea: "OTRANS", establecimiento: null });
    });
  });

  it("quien tiene un rol de área pero ninguna área no ve nada", async () => {
    await usar(async (contexto) => {
      const agente = await entrar(contexto, construir(contexto), [R.ESTABLECIMIENTO]);
      expect((await agente.get("/areas")).body).toEqual({ items: [], siguiente: null, hayMas: false });
    });
  });

  it("solo lista áreas activas y de un tipo de área activo", async () => {
    await usar(async (contexto) => {
      const marca = marcaDeNombre();
      const [a, b] = await sembrar(contexto, marca);
      await contexto.database.transaction("sistema:prueba", (tx) =>
        tx.query("UPDATE catalogo.area SET activo = false WHERE id = $1", [(b as EstablecimientoDePrueba).areaId]),
      );
      const agente = await entrar(contexto, construir(contexto), [R.GESTOR]);
      const vistas = await nombres(agente, { q: marca });
      expect(vistas).toHaveLength(2);
      expect(vistas).not.toContain((b as EstablecimientoDePrueba).nombre);
      expect(vistas).toContain((a as EstablecimientoDePrueba).nombre);
    });
  });

  it("filtra por tipo de área", async () => {
    await usar(async (contexto) => {
      const marca = marcaDeNombre();
      await sembrar(contexto, marca);
      const agente = await entrar(contexto, construir(contexto), [R.GESTOR]);
      expect(await nombres(agente, { q: marca, tipo: "ESTABLECIMIENTO" })).toHaveLength(3);
      expect(await nombres(agente, { q: marca, tipo: "DIRIS" })).toEqual([]);
      const otrans = await agente.get("/areas").query({ tipo: "OTRANS" });
      expect((otrans.body.items as AreaDto[]).map((x) => x.nombre)).toContain("OTRANS");
      expect((otrans.body.items as AreaDto[]).every((x) => x.tipoArea === "OTRANS")).toBe(true);
    });
  });

  it("q busca sin tildes ni mayúsculas, en parte del nombre, y trata % y _ como texto", async () => {
    await usar(async (contexto) => {
      const marca = marcaDeNombre();
      const [nandu] = await sembrar(contexto, marca);
      const agente = await entrar(contexto, construir(contexto), [R.GESTOR]);
      const esperado = [(nandu as EstablecimientoDePrueba).nombre];

      expect(await nombres(agente, { q: `${marca} nandu` })).toEqual(esperado);
      expect(await nombres(agente, { q: `${marca.toUpperCase()} ÑANDÚ` })).toEqual(esperado);
      expect(await nombres(agente, { q: `${marca.toLowerCase()} ñand` })).toEqual(esperado);
      expect(await nombres(agente, { q: `${marca}%` })).toEqual([]);
      expect(await nombres(agente, { q: `_${marca.slice(1)}` })).toEqual([]);
      expect(await nombres(agente, { q: "'; DROP TABLE catalogo.area; --" })).toEqual([]);
      expect(await nombres(agente, { q: marca })).toHaveLength(3);
    });
  });

  it("también busca sin tildes en las áreas que no son establecimientos (sin nombre_busqueda)", async () => {
    await usar(async (contexto) => {
      const marca = marcaDeNombre();
      await contexto.database.transaction("sistema:prueba", (tx) =>
        tx.query(
          "INSERT INTO catalogo.area (codigo, nombre, tipo_area_id) SELECT $1, $2, id FROM catalogo.tipo_area WHERE codigo = 'DIRIS'",
          [`DIRIS-${marca}`, `DIRIS Lima Ñorte ${marca}`],
        ),
      );
      const agente = await entrar(contexto, construir(contexto), [R.GESTOR]);
      const res = await agente.get("/areas").query({ q: `norte ${marca}` });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ tipoArea: "DIRIS", establecimiento: null });
    });
  });

  it("ordena por nombre e id y pagina con cursor sin repetir ni saltar, con cualquier límite", async () => {
    await usar(async (contexto) => {
      const marca = marcaDeNombre();
      await sembrar(contexto, marca);
      // Mismo nombre: se desempata por id.
      await contexto.database.transaction("sistema:prueba", async (tx) => {
        for (const codigo of ["DIRIS-REP-1", "DIRIS-REP-2", "DIRIS-REP-3"]) {
          await tx.query(
            "INSERT INTO catalogo.area (codigo, nombre, tipo_area_id) SELECT $1, $2, id FROM catalogo.tipo_area WHERE codigo = 'DIRIS'",
            [`${codigo}-${marca}`, `${marca} Repetida`],
          );
        }
      });
      const agente = await entrar(contexto, construir(contexto), [R.GESTOR]);
      const completo = await agente.get("/areas").query({ q: marca, limite: "200" });
      const esperado = (completo.body.items as AreaDto[]).map((x) => x.id);
      expect(esperado).toHaveLength(6);
      // Los repetidos van por id (el orden entre nombres distintos es el de la intercalación de la base).
      const repetidas = (completo.body.items as AreaDto[]).filter((x) => x.nombre.endsWith("Repetida")).map((x) => x.id);
      expect(repetidas).toEqual([...repetidas].sort((x, y) => x - y));

      for (const limite of [1, 2, 5, 6, 7]) {
        const vistos: number[] = [];
        let cursor: string | undefined;
        let paginas = 0;
        do {
          const res = await agente.get("/areas").query({ q: marca, limite: String(limite), ...(cursor ? { cursor } : {}) });
          expect(res.status).toBe(200);
          expect(res.body.items.length).toBeLessThanOrEqual(limite);
          expect(res.body.hayMas).toBe(res.body.siguiente !== null);
          vistos.push(...(res.body.items as AreaDto[]).map((x) => x.id));
          cursor = res.body.siguiente ?? undefined;
          paginas += 1;
        } while (cursor);
        expect(vistos).toEqual(esperado);
        expect(paginas).toBe(Math.ceil(6 / limite));
      }
    });
  });

  it("un cursor inválido responde 400", async () => {
    await usar(async (contexto) => {
      const agente = await entrar(contexto, construir(contexto), [R.GESTOR]);
      for (const cursor of ["basura", Buffer.from("1 OR 1=1|x").toString("base64url")]) {
        const res = await agente.get("/areas").query({ cursor });
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("VALIDATION_FAILED");
      }
    });
  });
});
