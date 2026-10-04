import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createFakeDatabase } from "@/test-utils/fake-database.js";
import { testEnv } from "@/test-utils/env.js";

describe("app", () => {
  const app = createApp(testEnv(), createFakeDatabase());

  it("responde el chequeo de salud", async () => {
    const res = await request(app).get("/salud");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: "ok" });
  });

  it("responde 404 con el formato estándar de error", async () => {
    const res = await request(app).get("/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 404,
      errorCode: "NOT_FOUND",
      path: "/no-existe",
    });
  });

  it("agrega cabeceras de seguridad y oculta x-powered-by", async () => {
    const res = await request(app).get("/salud");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("limita las peticiones con la cubeta de tokens, pero no el chequeo de salud", async () => {
    const limited = createApp(testEnv({ RATE_LIMIT_ANON_CAPACITY: "2" }), createFakeDatabase());
    for (let i = 0; i < 5; i += 1) expect((await request(limited).get("/salud")).status).toBe(200);

    await request(limited).get("/x");
    await request(limited).get("/x");
    const res = await request(limited).get("/x");
    expect(res.status).toBe(429);
    expect(res.body.errorCode).toBe("RATE_LIMITED");
  });
});
