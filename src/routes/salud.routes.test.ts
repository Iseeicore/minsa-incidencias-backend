import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "@/app.js";
import { createFakeDatabase } from "@/test-utils/fake-database.js";
import { testEnv } from "@/test-utils/env.js";

describe("rutas de salud", () => {
  it("/salud no toca la base de datos", async () => {
    const database = createFakeDatabase();
    const res = await request(createApp(testEnv(), database)).get("/salud");
    expect(res.status).toBe(200);
    expect(database.ping).not.toHaveBeenCalled();
  });

  it("/salud/listo responde 200 si la base responde", async () => {
    const res = await request(createApp(testEnv(), createFakeDatabase())).get("/salud/listo");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: "ok", baseDeDatos: "ok" });
  });

  it("/salud/listo responde 503 con el formato estándar y sin detalles si la base falla", async () => {
    const database = createFakeDatabase({
      ping: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secreta");
      }),
    });
    const res = await request(createApp(testEnv(), database)).get("/salud/listo");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, statusCode: 503, errorCode: "SERVICE_UNAVAILABLE" });
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|secreta|5432/);
  });

  it("/salud/listo no gasta la cubeta del límite de peticiones", async () => {
    const app = createApp(testEnv({ RATE_LIMIT_ANON_CAPACITY: "1" }), createFakeDatabase());
    for (let i = 0; i < 4; i += 1) expect((await request(app).get("/salud/listo")).status).toBe(200);
  });
});
