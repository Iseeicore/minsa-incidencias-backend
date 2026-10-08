import type { AreaRepository, FilaArea, FiltrosDeAreas } from "@/repositories/area.repository.js";
import { veTodasLasAreas } from "@/utils/acciones-permitidas.js";
import { codificarCursorDeAreas } from "@/utils/cursor-areas.js";
import type { SesionActual } from "./auth.types.js";
import type { AreaListadaDto, AreaServicio, ConsultaAreas, ListaAreasDto } from "./area.types.js";

const aDto = (fila: FilaArea): AreaListadaDto => ({
  id: fila.id,
  codigo: fila.codigo,
  nombre: fila.nombre,
  tipoArea: fila.tipoArea,
  establecimiento: fila.codigoRenipress
    ? { codigoRenipress: fila.codigoRenipress, nivelAtencion: fila.nivelAtencion, categoria: fila.categoria }
    : null,
});

/**
 * Catálogo de áreas para elegir el destino al derivar y para filtrar por establecimiento. Quien deriva o supervisa
 * (gestor, administrador) lista todas; los roles ligados a un área (OTRANS, establecimiento) solo ven la suya. Es el
 * servidor quien lo decide: el filtro por área no viene del navegador.
 */
export class AreaService implements AreaServicio {
  constructor(private readonly areas: AreaRepository) {}

  async listar(sesion: SesionActual, consulta: ConsultaAreas): Promise<ListaAreasDto> {
    const filtros: FiltrosDeAreas = {};
    if (consulta.tipo) filtros.tipo = consulta.tipo;
    if (consulta.texto) filtros.texto = consulta.texto;
    if (!veTodasLasAreas(sesion.roles)) filtros.soloAreaId = sesion.area?.id ?? null;

    // Se pide una de más: si llega, hay otra página y la última de esta es la posición del cursor.
    const filas = await this.areas.listar(filtros, consulta.limite + 1, consulta.despuesDe ?? null);
    const hayMas = filas.length > consulta.limite;
    const pagina = hayMas ? filas.slice(0, consulta.limite) : filas;
    const ultima = pagina.at(-1);
    return {
      items: pagina.map(aDto),
      siguiente: hayMas && ultima ? codificarCursorDeAreas({ nombre: ultima.nombre, id: ultima.id }) : null,
      hayMas,
    };
  }
}
