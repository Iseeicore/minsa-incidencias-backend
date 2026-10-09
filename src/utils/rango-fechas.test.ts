import { describe, expect, it } from "vitest";
import { diasDelRango, medianocheDe } from "@/utils/rango-fechas.js";

describe("rango de fechas", () => {
  it.each(["2026-10-08", "2024-02-29", "2026-12-31", "0100-01-01"])("acepta el día real %s", (dia) => {
    expect(medianocheDe(dia)).not.toBeNull();
  });

  it.each([
    "2026-02-31",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-10-00",
    "0001-01-01",
    "2026-1-5",
    "26-10-08",
    "2026/10/08",
    "20261008",
    "2026-10-08T00:00:00Z",
    " 2026-10-08",
    "2026-10-08; DROP TABLE x",
    "",
  ])("rechaza %j", (dia) => {
    expect(medianocheDe(dia)).toBeNull();
  });

  it("cuenta los días con ambos extremos, también cruzando un año bisiesto", () => {
    expect(diasDelRango("2026-10-08", "2026-10-08")).toBe(1);
    expect(diasDelRango("2026-10-08", "2026-10-09")).toBe(2);
    expect(diasDelRango("2024-01-01", "2024-12-31")).toBe(366);
    expect(diasDelRango("2025-01-01", "2025-12-31")).toBe(365);
    expect(diasDelRango("2026-10-09", "2026-10-08")).toBe(0);
  });

  it("no calcula nada con una fecha inválida", () => {
    expect(diasDelRango("2026-02-31", "2026-03-01")).toBeNull();
    expect(diasDelRango("2026-03-01", "x")).toBeNull();
  });
});
