import { describe, expect, it } from "vitest";
import { CategoriaIncidencia as C } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia as E } from "@/enums/estado-incidencia.enum.js";
import { construirHistorial, textoHace, type FilaHistorial } from "@/utils/historial-incidencia.js";

const AHORA = new Date("2026-10-05T12:00:00.000Z");
const haceHoras = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000);

const base: FilaHistorial = {
  operacion: "ACTUALIZACION",
  actor: "usuario:ana@minsa.gob.pe",
  actorNombre: "Ana Prueba",
  fechaHora: haceHoras(2),
  ia: false,
  categoriaIa: null,
  confianza: null,
  version: null,
  corregida: false,
  categoriaAntes: null,
  categoriaDespues: null,
  confirmada: false,
  estadoNuevo: null,
  resolvio: false,
};
const fila = (cambios: Partial<FilaHistorial>): FilaHistorial => ({ ...base, ...cambios });

describe("textoHace", () => {
  it.each([
    [0, "hace menos de 1 h"],
    [1, "hace 1 h"],
    [20, "hace 20 h"],
    [47, "hace 47 h"],
    [48, "hace 2 d"],
    [100, "hace 4 d"],
  ])("%i horas se lee %s", (horas, esperado) => {
    expect(textoHace(horas)).toBe(esperado);
  });
});

describe("construirHistorial", () => {
  const construir = (filas: FilaHistorial[]) => construirHistorial(filas, "WhatsApp", AHORA);

  it("la creación se cuenta como recibido por el canal", () => {
    expect(construir([fila({ operacion: "CREACION", actor: "ciudadano:abc", actorNombre: null, fechaHora: haceHoras(20) })])).toEqual([
      { titulo: "Recibido por WhatsApp", detalle: "Registrado como incidencia.", hora: "hace 20 h", fecha: haceHoras(20).toISOString() },
    ]);
  });

  it("cuando la IA clasifica dice la categoría, la confianza y la versión", () => {
    const [item] = construir([fila({ ia: true, categoriaIa: C.RECLAMO, confianza: 58, version: "v0.3", actor: "sistema:ia", actorNombre: null })]);
    expect(item).toMatchObject({ titulo: "La IA clasificó el caso", detalle: "Reclamo con 58 % de confianza (clasificador v0.3)." });
  });

  it("la clasificación sin confianza ni versión no inventa números", () => {
    const [item] = construir([fila({ ia: true, categoriaIa: C.QUEJA, actor: "sistema:ia", actorNombre: null })]);
    expect(item).toMatchObject({ titulo: "La IA clasificó el caso", detalle: "Queja." });
  });

  it("una corrección dice de qué categoría a cuál y quién", () => {
    const [item] = construir([fila({ corregida: true, categoriaAntes: C.RECLAMO, categoriaDespues: C.QUEJA })]);
    expect(item).toMatchObject({ titulo: "Categoría corregida", detalle: "De Reclamo a Queja, por Ana Prueba." });
  });

  it("una confirmación dice quién la hizo", () => {
    const [item] = construir([fila({ confirmada: true })]);
    expect(item).toMatchObject({ titulo: "Categoría confirmada", detalle: "Por Ana Prueba." });
  });

  it("pasar a derivado, a en gestión y a archivado tienen su título", () => {
    const items = construir([
      fila({ estadoNuevo: E.DERIVADO }),
      fila({ estadoNuevo: E.EN_GESTION }),
      fila({ estadoNuevo: E.ARCHIVADO, actor: "sistema:vencimiento", actorNombre: null }),
    ]);
    expect(items.map((i) => i.titulo)).toEqual(["Derivado al área", "Tomado en gestión", "Archivado"]);
    expect(items[0]?.detalle).toBe("Por Ana Prueba.");
    expect(items[2]?.detalle).toBe("Por Sistema.");
  });

  it("registrar la resolución gana sobre el cambio de estado que la acompaña", () => {
    const [item] = construir([fila({ resolvio: true, estadoNuevo: E.RESUELTO })]);
    expect(item).toMatchObject({ titulo: "Caso resuelto", detalle: "Por Ana Prueba." });
  });

  it("un actor que no es persona ni sistema no se revela", () => {
    const [item] = construir([fila({ confirmada: true, actor: "operador:gestor", actorNombre: null })]);
    expect(item?.detalle).toBe("Por una persona.");
  });

  it("ignora los cambios que no son un hito y conserva el orden recibido", () => {
    const items = construir([
      fila({ ia: true, categoriaIa: C.QUEJA, fechaHora: haceHoras(10) }),
      fila({ fechaHora: haceHoras(9) }),
      fila({ confirmada: true, fechaHora: haceHoras(8) }),
    ]);
    expect(items.map((i) => i.titulo)).toEqual(["La IA clasificó el caso", "Categoría confirmada"]);
  });

  it("nunca devuelve el contenido del caso ni el identificador del actor", () => {
    const texto = JSON.stringify(construir([fila({ confirmada: true }), fila({ estadoNuevo: E.DERIVADO })]));
    expect(texto).not.toContain("ana@minsa.gob.pe");
    expect(texto).not.toContain("usuario:");
  });
});
