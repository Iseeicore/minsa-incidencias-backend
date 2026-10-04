import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createFakeDatabase } from "@/test-utils/fake-database.js";
import { testEnv } from "@/test-utils/env.js";

const ALLOWED = "http://localhost:4010";

describe("CORS", () => {
  const app = createApp(testEnv({ CORS_ORIGINS: `${ALLOWED}, https://gestion.minsa.gob.pe` }), createFakeDatabase());

  it("permite el origen del frontend y las credenciales", async () => {
    const res = await request(app).get("/salud").set("Origin", ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("responde la petición previa (preflight) con métodos, cabeceras y caché", async () => {
    const res = await request(app)
      .options("/auth/login")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toBe("Content-Type");
    expect(res.headers["access-control-max-age"]).toBe("600");
  });

  it("acepta el segundo origen de la lista", async () => {
    const res = await request(app).get("/salud").set("Origin", "https://gestion.minsa.gob.pe");
    expect(res.headers["access-control-allow-origin"]).toBe("https://gestion.minsa.gob.pe");
  });

  it("no da permiso a un origen que no está en la lista", async () => {
    const res = await request(app).get("/salud").set("Origin", "https://sitio-malicioso.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sin origenes configurados no da permiso a ninguno", async () => {
    const closed = createApp(testEnv({ CORS_ORIGINS: "" }), createFakeDatabase());
    const res = await request(closed).get("/salud").set("Origin", ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
