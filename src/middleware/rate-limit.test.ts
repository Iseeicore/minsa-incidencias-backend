import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { errorHandler } from "@/middleware/error-handler.js";
import { createGeneralResolver, createLoginResolver, rateLimit } from "@/middleware/rate-limit.js";
import { testEnv } from "@/test-utils/env.js";
import { TokenBucketLimiter } from "@/utils/token-bucket.js";

function buildApp(overrides: Record<string, string>, getUserId?: (req: express.Request) => string | null) {
  const app = express();
  const resolver = createGeneralResolver(testEnv(overrides), getUserId);
  app.use(rateLimit(new TokenBucketLimiter(), resolver));
  app.get("/recurso", (_req, res) => {
    res.json({ ok: true });
  });
  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { log: { error: () => undefined } });
    errorHandler(error, req, res, next);
  });
  return app;
}

describe("límite del login (por correo, no por IP)", () => {
  function loginApp() {
    const app = express();
    app.use(express.json());
    app.use(rateLimit(new TokenBucketLimiter(), createLoginResolver(testEnv())));
    app.post("/auth/login", (_req, res) => {
      res.json({ ok: true });
    });
    app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { log: { error: () => undefined } });
      errorHandler(error, req, res, next);
    });
    return app;
  }

  const login = (app: express.Express, body: object, ip = "10.0.0.1") =>
    request(app).post("/auth/login").set("X-Forwarded-For", ip).send(body);

  it("permite 5 intentos por correo y bloquea el sexto con la espera de 3 minutos", async () => {
    const app = loginApp();
    for (let i = 0; i < 5; i += 1) expect((await login(app, { correo: "ana@minsa.gob.pe" })).status).toBe(200);
    const res = await login(app, { correo: "ana@minsa.gob.pe" });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("180");
  });

  it("un correo bloqueado no afecta a otro correo de la misma red", async () => {
    const app = loginApp();
    for (let i = 0; i < 6; i += 1) await login(app, { correo: "ana@minsa.gob.pe" });
    expect((await login(app, { correo: "luis@minsa.gob.pe" })).status).toBe(200);
  });

  it("cuenta el mismo correo aunque cambien las mayúsculas, los espacios o la IP", async () => {
    const app = loginApp();
    await login(app, { correo: "ana@minsa.gob.pe" }, "10.0.0.1");
    await login(app, { correo: " ANA@minsa.gob.pe " }, "10.0.0.2");
    await login(app, { correo: "Ana@Minsa.gob.pe" }, "10.0.0.3");
    await login(app, { correo: "ana@minsa.gob.pe" }, "10.0.0.4");
    await login(app, { correo: "ana@minsa.gob.pe" }, "10.0.0.5");
    expect((await login(app, { correo: "ana@minsa.gob.pe" }, "10.0.0.6")).status).toBe(429);
  });

  it("sin correo en el cuerpo limita por IP para que omitirlo no sirva de atajo", async () => {
    const app = loginApp();
    for (let i = 0; i < 5; i += 1) await login(app, {});
    expect((await login(app, {})).status).toBe(429);
  });
});

describe("rateLimit", () => {
  it("agrega las cabeceras de límite y restante", async () => {
    const res = await request(buildApp({ RATE_LIMIT_ANON_CAPACITY: "3" })).get("/recurso");
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBe("3");
    expect(res.headers["ratelimit-remaining"]).toBe("2");
  });

  it("al agotar la cubeta responde 429 con el formato estándar y Retry-After", async () => {
    const app = buildApp({ RATE_LIMIT_ANON_CAPACITY: "2", RATE_LIMIT_WINDOW_SECONDS: "60" });
    await request(app).get("/recurso");
    await request(app).get("/recurso");
    const res = await request(app).get("/recurso");

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 429,
      errorCode: "RATE_LIMITED",
      path: "/recurso",
    });
  });

  it("al estar autenticado usa la capacidad mayor y una cubeta propia", async () => {
    const app = buildApp({ RATE_LIMIT_ANON_CAPACITY: "1", RATE_LIMIT_AUTH_CAPACITY: "5" }, () => "usuario-1");
    const first = await request(app).get("/recurso");
    expect(first.headers["ratelimit-limit"]).toBe("5");
    for (let i = 0; i < 4; i += 1) await request(app).get("/recurso");
    expect((await request(app).get("/recurso")).status).toBe(429);
  });
});
