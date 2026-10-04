import { Writable } from "node:stream";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { createFakeDatabase } from "@/test-utils/fake-database.js";
import { testEnv } from "@/test-utils/env.js";

function capturingLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { logger: pino({ level: "info" }, stream), lines };
}

describe("registro de peticiones", () => {
  it("no escribe la query, las cabeceras ni las cookies en los logs", async () => {
    const { logger, lines } = capturingLogger();
    const app = createApp(testEnv(), createFakeDatabase(), logger);

    await request(app).get("/salud?token=secreto-del-enlace").set("Cookie", "gestion_sid=valor-de-cookie").set("Authorization", "Bearer abc");

    const output = lines.join("");
    expect(output).toContain("/salud");
    expect(output).not.toMatch(/secreto-del-enlace|token=|valor-de-cookie|Bearer|authorization/i);
  });

  it("registra método, ruta, estado y duración", async () => {
    const { logger, lines } = capturingLogger();
    await request(createApp(testEnv(), createFakeDatabase(), logger)).get("/salud");
    const entry = JSON.parse(lines.find((line) => line.includes("request completed")) as string);
    expect(entry.req).toMatchObject({ method: "GET", url: "/salud" });
    expect(entry.res).toEqual({ statusCode: 200 });
    expect(typeof entry.responseTime).toBe("number");
  });
});
