import express from "express";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";
import { errorHandler, notFoundHandler } from "@/middleware/error-handler.js";

function buildApp() {
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
  app.use(express.json({ limit: "1kb" }));
  app.get("/conflicto", () => {
    throw new AppError(HttpStatus.CONFLICT, ErrorCode.CONFLICT);
  });
  app.get("/asincrono", async () => {
    throw new AppError(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN);
  });
  app.post("/validar", (req) => {
    z.object({ correo: z.email() }).parse(req.body);
  });
  app.get("/roto", () => {
    throw new Error("ECONNREFUSED 10.0.0.5:5432 password=secreta");
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("manejador global de errores", () => {
  const app = buildApp();

  it("responde un AppError con el formato estándar", async () => {
    const res = await request(app).get("/conflicto?token=abc");
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, statusCode: 409, errorCode: "CONFLICT", path: "/conflicto" });
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it("captura los errores de handlers async sin envolverlos (Express 5)", async () => {
    const res = await request(app).get("/asincrono");
    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe("FORBIDDEN");
  });

  it("convierte un error de validación de zod en 400 con el detalle por campo", async () => {
    const res = await request(app).post("/validar").send({ correo: "no-es-correo" });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("VALIDATION_FAILED");
    expect(res.body.details).toEqual([{ path: "correo", message: expect.any(String) }]);
  });

  it("responde 400 ante un JSON mal formado", async () => {
    const res = await request(app).post("/validar").set("Content-Type", "application/json").send("{roto");
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("VALIDATION_FAILED");
  });

  it("responde 413 si el cuerpo supera el límite", async () => {
    const res = await request(app).post("/validar").send({ relleno: "x".repeat(2_000) });
    expect(res.status).toBe(413);
    expect(res.body.errorCode).toBe("PAYLOAD_TOO_LARGE");
  });

  it("enmascara un error de infraestructura: 500 genérico, sin detalles ni stack", async () => {
    const res = await request(app).get("/roto");
    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|secreta|stack|5432/);
  });

  it("responde 404 con el formato estándar", async () => {
    const res = await request(app).get("/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, errorCode: "NOT_FOUND", path: "/no-existe" });
  });
});
