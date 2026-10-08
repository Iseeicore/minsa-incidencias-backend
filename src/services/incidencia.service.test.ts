import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/database/database.js";
import { EstadoIncidencia as E } from "@/enums/estado-incidencia.enum.js";
import { TipoArea } from "@/enums/tipo-area.enum.js";
import { VistaCodigo } from "@/enums/vista-codigo.enum.js";
import type { IncidenciaRepository } from "@/repositories/incidencia.repository.js";
import type { SesionActual } from "./auth.types.js";
import { IncidenciaService } from "./incidencia.service.js";

const sesion: SesionActual = {
  sesionId: "s1",
  usuarioId: "u1",
  correo: "ana@minsa.gob.pe",
  nombreCompleto: "Ana Prueba",
  roles: ["GESTOR"],
  area: { id: 7, codigo: "EESS-1", nombre: "Hospital", tipo: TipoArea.ESTABLECIMIENTO },
  vistas: [VistaCodigo.CASOS],
};

function servicioCon(porEstado: Partial<Record<E, number>>, total = 0, tope = 2) {
  const repo = {
    contarPorEstado: vi.fn(async () => new Map(Object.entries(porEstado) as [E, number][])),
    contarAcotado: vi.fn(async () => total),
  };
  const servicio = new IncidenciaService(repo as unknown as IncidenciaRepository, {} as Database, { atencionDias: 10, vigenciaDias: 30, avisoHoras: 24 }, tope);
  return { servicio, repo };
}

describe("IncidenciaService.conteos", () => {
  it("devuelve todos los estados, con 0 los que el repositorio no trae, y todos como su suma", async () => {
    const { servicio } = servicioCon({ [E.REGISTRADO]: 1, [E.DERIVADO]: 1 });
    expect(await servicio.conteos(sesion, {})).toEqual({
      todos: { cantidad: 2, conMas: false },
      total: { cantidad: 2, conMas: false },
      porEstado: {
        registrado: { cantidad: 1, conMas: false },
        clasificado: { cantidad: 0, conMas: false },
        derivado: { cantidad: 1, conMas: false },
        "en-gestion": { cantidad: 0, conMas: false },
        resuelto: { cantidad: 0, conMas: false },
        archivado: { cantidad: 0, conMas: false },
      },
    });
  });

  it("sin estado ni motivo no hace una consulta aparte para el total", async () => {
    const { servicio, repo } = servicioCon({ [E.REGISTRADO]: 1 });
    await servicio.conteos(sesion, { categoria: "queja" });
    expect(repo.contarAcotado).not.toHaveBeenCalled();
    expect(repo.contarPorEstado).toHaveBeenCalledWith(expect.anything(), { categoria: "QUEJA" }, 2);
  });

  it("con estado o motivo, el total usa todos los filtros y las pestañas ninguno de los dos", async () => {
    const { servicio, repo } = servicioCon({ [E.ARCHIVADO]: 2 }, 1);
    const conteos = await servicio.conteos(sesion, { estado: "archivado", motivoArchivo: "NO_CORRESPONDE", texto: "x" });
    expect(repo.contarPorEstado).toHaveBeenCalledWith(expect.anything(), { texto: "x" }, 2);
    expect(repo.contarAcotado).toHaveBeenCalledWith(expect.anything(), { estado: "ARCHIVADO", motivoArchivo: "NO_CORRESPONDE", texto: "x" }, 2);
    expect(conteos.total).toEqual({ cantidad: 1, conMas: false });
    expect(conteos.porEstado.archivado).toEqual({ cantidad: 2, conMas: false });
  });

  it("con más casos que el tope devuelve el tope y conMas, en cada contador", async () => {
    // El repositorio cuenta hasta tope + 1 (3 con tope 2).
    const { servicio } = servicioCon({ [E.REGISTRADO]: 3, [E.DERIVADO]: 1 }, 3);
    const conteos = await servicio.conteos(sesion, { estado: "registrado" });
    expect(conteos.porEstado.registrado).toEqual({ cantidad: 2, conMas: true });
    expect(conteos.porEstado.derivado).toEqual({ cantidad: 1, conMas: false });
    expect(conteos.todos).toEqual({ cantidad: 2, conMas: true });
    expect(conteos.total).toEqual({ cantidad: 2, conMas: true });
  });

  it("varios estados que cada uno cabe en el tope pero juntos lo superan marcan conMas en todos", async () => {
    const { servicio } = servicioCon({ [E.REGISTRADO]: 2, [E.DERIVADO]: 1 });
    const conteos = await servicio.conteos(sesion, {});
    expect(conteos.todos).toEqual({ cantidad: 2, conMas: true });
    expect(conteos.porEstado.registrado).toEqual({ cantidad: 2, conMas: false });
  });
});
