import { describe, expect, it } from "vitest";
import { ArgonPasswordHasher } from "@/utils/password-hasher.js";

describe("ArgonPasswordHasher", () => {
  const hasher = new ArgonPasswordHasher();

  it("genera una huella Argon2id y la verifica", async () => {
    const huella = await hasher.hash("una-clave-larga");
    expect(huella.startsWith("$argon2id$")).toBe(true);
    expect(huella).not.toContain("una-clave-larga");
    expect(await hasher.verify(huella, "una-clave-larga")).toBe(true);
    expect(await hasher.verify(huella, "otra-clave")).toBe(false);
  });

  it("usa una sal distinta en cada huella", async () => {
    expect(await hasher.hash("misma")).not.toBe(await hasher.hash("misma"));
  });

  it("una huella mal formada no verifica y no lanza", async () => {
    expect(await hasher.verify("esto-no-es-una-huella", "x")).toBe(false);
  });
});
