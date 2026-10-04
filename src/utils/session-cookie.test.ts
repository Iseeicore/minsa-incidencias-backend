import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { testEnv, TEST_COOKIE_SECRET } from "@/test-utils/env.js";
import {
  clearSessionCookie,
  readSessionId,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "@/utils/session-cookie.js";

const SESSION_ID = "0190b0c2-7e1a-7c3e-8f2b-1a2b3c4d5e6f";

function buildApp(overrides: Record<string, string> = {}) {
  const env = testEnv(overrides);
  const app = express();
  app.use(cookieParser(TEST_COOKIE_SECRET));
  app.get("/crear", (_req, res) => {
    setSessionCookie(res, env, SESSION_ID, 900);
    res.end();
  });
  app.get("/leer", (req, res) => {
    res.json({ sessionId: readSessionId(req) });
  });
  app.get("/cerrar", (_req, res) => {
    clearSessionCookie(res, env);
    res.end();
  });
  return app;
}

async function issuedCookie(app: express.Express): Promise<string> {
  const res = await request(app).get("/crear");
  return (res.headers["set-cookie"] as unknown as string[])[0] as string;
}

describe("cookie de sesión", () => {
  const app = buildApp();

  it("se emite firmada, HttpOnly, SameSite=Strict y con vigencia", async () => {
    const cookie = await issuedCookie(app);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=s%3A`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).not.toContain("Secure");
  });

  it("en producción se emite además con Secure", async () => {
    const cookie = await issuedCookie(buildApp({ NODE_ENV: "production" }));
    expect(cookie).toContain("Secure");
  });

  it("devuelve el identificador cuando la firma es válida", async () => {
    const cookie = await issuedCookie(app);
    const res = await request(app).get("/leer").set("Cookie", cookie.split(";")[0] as string);
    expect(res.body.sessionId).toBe(SESSION_ID);
  });

  it("devuelve null si no hay cookie", async () => {
    expect((await request(app).get("/leer")).body.sessionId).toBeNull();
  });

  it("devuelve null si la cookie fue alterada", async () => {
    const cookie = (await issuedCookie(app)).split(";")[0] as string;
    const tampered = cookie.replace(/.$/, (last) => (last === "A" ? "B" : "A"));
    expect((await request(app).get("/leer").set("Cookie", tampered)).body.sessionId).toBeNull();
  });

  it("devuelve null si la cookie no está firmada", async () => {
    const res = await request(app).get("/leer").set("Cookie", `${SESSION_COOKIE_NAME}=${SESSION_ID}`);
    expect(res.body.sessionId).toBeNull();
  });

  it("devuelve null si la cookie está firmada pero no es un UUID", async () => {
    const forged = express();
    forged.use(cookieParser(TEST_COOKIE_SECRET));
    forged.get("/crear", (_req, res) => {
      res.cookie(SESSION_COOKIE_NAME, "admin", { signed: true });
      res.end();
    });
    const issued = ((await request(forged).get("/crear")).headers["set-cookie"] as unknown as string[])[0] as string;
    const res = await request(app).get("/leer").set("Cookie", issued.split(";")[0] as string);
    expect(res.body.sessionId).toBeNull();
  });

  it("al cerrar la sesión vence la cookie con los mismos atributos", async () => {
    const res = await request(app).get("/cerrar");
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0] as string;
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });
});
