import { MENSAJE_CASO_NO_ENCONTRADO } from "@/constants/mensajes-incidencias.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";
import type { AnalisisIncidenciaRepository } from "@/repositories/analisis-incidencia.repository.js";
import type { IncidenciaRepository } from "@/repositories/incidencia.repository.js";
import type { SesionActual } from "@/services/auth.types.js";
import type {
  AnalisisIaDto,
  AnalisisIncidenciaServicio,
} from "@/services/analisis-incidencia/analisis-incidencia.types.js";
import { construirAnalisisDto } from "@/services/analisis-incidencia/construir-analisis-dto.js";
import { visibilidadDe } from "@/services/incidencia.service.js";

export const MENSAJE_SIN_ANALISIS_DE_IA =
  "El caso todavía no tiene análisis de la IA.";

/**
 * Lectura del análisis de la IA de un caso. La ruta ya limita el acceso a OTRANS y al administrador; aquí además se aplica la misma
 * visibilidad que el resto de la bandeja (OTRANS solo ve lo destinado a su área), de modo que un caso que la persona no puede ver
 * responde igual que uno que no existe. Solo lectura.
 */
export class AnalisisIncidenciaService implements AnalisisIncidenciaServicio {
  constructor(
    private readonly casos: IncidenciaRepository,
    private readonly analisis: AnalisisIncidenciaRepository,
  ) {}

  async obtener(sesion: SesionActual, codigo: string): Promise<AnalisisIaDto> {
    const caso = await this.casos.buscarPorCodigo(
      codigo,
      visibilidadDe(sesion),
    );
    if (!caso)
      throw new AppError(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        MENSAJE_CASO_NO_ENCONTRADO,
      );
    const fila = await this.analisis.buscar(caso.id);
    if (!fila)
      throw new AppError(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        MENSAJE_SIN_ANALISIS_DE_IA,
      );
    return construirAnalisisDto(caso.codigo, fila);
  }
}
