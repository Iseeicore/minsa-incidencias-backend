import type { Env } from "@/config/env.js";
import {
  CATEGORIA_API,
  CATEGORIA_DESDE_API,
  CATEGORIA_ETIQUETA,
  ESTADO_API,
  ESTADO_DESDE_API,
  POR_VENCER_LISTA_MAXIMA,
  SIN_CATEGORIA_API,
} from "@/constants/incidencias.js";
import {
  MENSAJE_ACCION_NO_PERMITIDA,
  MENSAJE_ACCION_REALIZADA,
  MENSAJE_AREA_DESTINO_INVALIDA,
  MENSAJE_CASO_NO_ENCONTRADO,
  MENSAJE_FALTA_CATEGORIA,
  MENSAJE_FALTA_RESOLUCION,
  MENSAJE_MISMA_CATEGORIA,
  MENSAJE_SIN_DESTINO_DE_DERIVACION,
  mensajeCategoriaCorregidaFueraDeVista,
} from "@/constants/mensajes-incidencias.js";
import { actorUsuarioInterno } from "@/database/actor.js";
import type { Database, DbExecutor } from "@/database/database.js";
import { traducirErrorDeBase } from "@/database/reglas-de-la-base.js";
import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { AppError } from "@/errors/app-error.js";
import {
  type FilaCaso,
  type FiltrosDeListado,
  type IncidenciaRepository,
  type VisibilidadCasos,
} from "@/repositories/incidencia.repository.js";
import { accionesPermitidas, reglasDeAvisos, veCasosSinCategoria } from "@/utils/acciones-permitidas.js";
import { codificarCursor } from "@/utils/cursor-listado.js";
import { construirHistorial } from "@/utils/historial-incidencia.js";
import { calcularPlazo, horasEntre, type PlazosConfigurados } from "@/utils/plazo-incidencia.js";
import { describirReclamante } from "@/utils/reclamante.js";
import type { SesionActual } from "./auth.types.js";
import type {
  CasoDetalleDto,
  CasoResumenDto,
  ConsultaListado,
  DatosAccion,
  EvidenciaDto,
  IncidenciaServicio,
  ListaCasosDto,
  PorVencerDto,
  ResultadoAccionDto,
} from "./incidencia.types.js";

export const plazosDeEntorno = (env: Pick<Env, "PLAZO_ATENCION_DIAS" | "VIGENCIA_RESOLUCION_DIAS" | "PLAZO_AVISO_HORAS">): PlazosConfigurados => ({
  atencionDias: env.PLAZO_ATENCION_DIAS,
  vigenciaDias: env.VIGENCIA_RESOLUCION_DIAS,
  avisoHoras: env.PLAZO_AVISO_HORAS,
});

const noEncontrado = () => new AppError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, MENSAJE_CASO_NO_ENCONTRADO);

function visibilidadDe(sesion: SesionActual): VisibilidadCasos {
  return { roles: sesion.roles, verSinCategoria: veCasosSinCategoria(sesion.roles), areaId: sesion.area?.id ?? null };
}

function filtrosDe(consulta: ConsultaListado): FiltrosDeListado {
  const filtros: FiltrosDeListado = {};
  if (consulta.estado) filtros.estado = ESTADO_DESDE_API[consulta.estado];
  if (consulta.categoria === SIN_CATEGORIA_API) filtros.sinCategoria = true;
  else if (consulta.categoria) filtros.categoria = CATEGORIA_DESDE_API[consulta.categoria];
  if (consulta.texto) filtros.texto = consulta.texto;
  if (consulta.establecimiento) filtros.establecimiento = consulta.establecimiento;
  return filtros;
}

/**
 * Casos, detalle y acciones sobre las incidencias. Qué ve y qué puede hacer cada persona lo decide aquí en el
 * servidor: el rol nunca viaja al navegador, solo las acciones permitidas de cada caso. Las reglas del negocio
 * las aplica la base; este servicio declara quién actúa y traduce sus rechazos a errores claros.
 */
export class IncidenciaService implements IncidenciaServicio {
  constructor(
    private readonly casos: IncidenciaRepository,
    private readonly database: Database,
    private readonly plazos: PlazosConfigurados,
  ) {}

  async listar(sesion: SesionActual, consulta: ConsultaListado): Promise<ListaCasosDto> {
    // Se pide un caso de más: si llega, hay otra página y el último de esta es la posición del cursor.
    const filas = await this.casos.listar(visibilidadDe(sesion), filtrosDe(consulta), consulta.limite + 1, consulta.despuesDe ?? null);
    const hayMas = filas.length > consulta.limite;
    const pagina = hayMas ? filas.slice(0, consulta.limite) : filas;
    const ultima = pagina.at(-1);
    return {
      items: pagina.map((fila) => this.resumir(fila, sesion)),
      siguiente: hayMas && ultima ? codificarCursor({ fechaCreacion: ultima.fechaCreacion, id: ultima.id }) : null,
      hayMas,
    };
  }

  async detalle(sesion: SesionActual, codigo: string): Promise<CasoDetalleDto> {
    const fila = await this.casos.buscarPorCodigo(codigo, visibilidadDe(sesion));
    if (!fila) throw noEncontrado();
    return this.detallar(fila, sesion);
  }

  async porVencer(sesion: SesionActual): Promise<PorVencerDto> {
    const visible = visibilidadDe(sesion);
    const pendientes = reglasDeAvisos(sesion.roles);
    const { atencionDias, avisoHoras } = this.plazos;
    const [conteo, filas] = await Promise.all([
      this.casos.contarPorVencer(visible, atencionDias, avisoHoras, pendientes),
      this.casos.listarPorVencer(visible, atencionDias, avisoHoras, POR_VENCER_LISTA_MAXIMA, pendientes),
    ]);
    return {
      total: conteo.total,
      porVencer: conteo.total - conteo.vencidos,
      vencidos: conteo.vencidos,
      casos: filas.map((fila) => this.resumir(fila, sesion)),
    };
  }

  async ejecutar(sesion: SesionActual, codigo: string, accion: AccionIncidencia, datos: DatosAccion): Promise<ResultadoAccionDto> {
    const visible = visibilidadDe(sesion);
    try {
      await this.database.transaction(actorUsuarioInterno(sesion.correo), async (tx) => {
        const fila = await this.casos.buscarPorCodigo(codigo, visible, tx, true);
        if (!fila) throw noEncontrado();
        const permitidas = accionesPermitidas(sesion.roles, {
          estado: fila.estado,
          categoria: fila.categoria,
          revisada: fila.revisada,
        });
        if (!permitidas.includes(accion)) {
          throw new AppError(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, MENSAJE_ACCION_NO_PERMITIDA[accion]);
        }
        await this.aplicar(tx, fila, accion, datos);
      });
    } catch (error) {
      throw traducirErrorDeBase(error);
    }

    const actualizado = await this.casos.buscarPorCodigo(codigo, visible);
    if (actualizado) {
      return { mensaje: MENSAJE_ACCION_REALIZADA[accion], caso: await this.detallar(actualizado, sesion) };
    }
    const nueva = datos.categoria ? CATEGORIA_DESDE_API[datos.categoria] : null;
    const mensaje =
      accion === AccionIncidencia.CORREGIR && nueva
        ? mensajeCategoriaCorregidaFueraDeVista(CATEGORIA_ETIQUETA[nueva])
        : MENSAJE_ACCION_REALIZADA[accion];
    return { mensaje, caso: null };
  }

  private async aplicar(tx: DbExecutor, fila: FilaCaso, accion: AccionIncidencia, datos: DatosAccion): Promise<void> {
    switch (accion) {
      case AccionIncidencia.CONFIRMAR:
        return this.casos.confirmar(tx, fila.id);
      case AccionIncidencia.CORREGIR: {
        if (!datos.categoria) throw new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, MENSAJE_FALTA_CATEGORIA);
        const nueva = CATEGORIA_DESDE_API[datos.categoria];
        if (nueva === fila.categoria) {
          throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, MENSAJE_MISMA_CATEGORIA);
        }
        return this.casos.corregir(tx, fila.id, nueva);
      }
      case AccionIncidencia.DERIVAR:
        return this.casos.derivar(tx, fila.id, await this.areaDeDerivacion(tx, fila, datos));
      case AccionIncidencia.TOMAR:
        return this.casos.cambiarEstado(tx, fila.id, EstadoIncidencia.EN_GESTION);
      case AccionIncidencia.RESOLVER: {
        if (!datos.resolucion) throw new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, MENSAJE_FALTA_RESOLUCION);
        return this.casos.resolver(tx, fila.id, datos.resolucion);
      }
    }
  }

  /** El área elegida por la persona o, si no eligió, la del establecimiento de origen; siempre de un establecimiento activo. */
  private async areaDeDerivacion(tx: DbExecutor, fila: FilaCaso, datos: DatosAccion): Promise<number> {
    if (!datos.areaDestino && fila.areaOrigenId === null) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, MENSAJE_SIN_DESTINO_DE_DERIVACION);
    }
    const criterio = datos.areaDestino ? { codigo: datos.areaDestino } : { id: fila.areaOrigenId as number };
    const areaId = await this.casos.areaReceptora(criterio, tx);
    if (areaId === null) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, MENSAJE_AREA_DESTINO_INVALIDA);
    return areaId;
  }

  private resumir(fila: FilaCaso, sesion: SesionActual): CasoResumenDto {
    return {
      codigo: fila.codigo,
      categoria: fila.categoria ? CATEGORIA_API[fila.categoria] : null,
      categoriaIa: fila.categoriaIa ? CATEGORIA_API[fila.categoriaIa] : null,
      confianzaIa: fila.confianzaIa,
      etiquetas: [],
      prioridad: null,
      organismo: null,
      area: fila.areaCodigo && fila.areaNombre ? { codigo: fila.areaCodigo, nombre: fila.areaNombre } : null,
      establecimiento:
        fila.establecimientoCodigo && fila.establecimientoNombre
          ? {
              codigoRenipress: fila.establecimientoCodigo,
              nombre: fila.establecimientoNombre,
              nivelAtencion: fila.establecimientoNivel,
              categoria: fila.establecimientoCategoria,
            }
          : null,
      responsable: fila.responsable,
      estado: ESTADO_API[fila.estado],
      horasDesdeLlegada: Math.max(0, horasEntre(fila.fechaCreacion, fila.ahora)),
      horasDesdeResolucion: fila.resueltoEn ? Math.max(0, horasEntre(fila.resueltoEn, fila.ahora)) : null,
      revisadoPorHumano: fila.revisada,
      corregida: fila.corregida,
      plazo: calcularPlazo(
        { estado: fila.estado, fechaCreacion: fila.fechaCreacion, resueltoEn: fila.resueltoEn, ahora: fila.ahora },
        this.plazos,
      ),
      acciones: accionesPermitidas(sesion.roles, { estado: fila.estado, categoria: fila.categoria, revisada: fila.revisada }),
    };
  }

  private async detallar(fila: FilaCaso, sesion: SesionActual): Promise<CasoDetalleDto> {
    const [evidencias, historial] = await Promise.all([this.casos.evidencias(fila.id), this.casos.historial(fila.id)]);
    const evidenciasDto: EvidenciaDto[] = evidencias.map((evidencia, indice) => ({
      nombre: evidencia.nombre ?? `${evidencia.tipoNombre} ${indice + 1}`,
      tipo: evidencia.tipo.toLowerCase(),
      fecha: evidencia.fecha.toISOString(),
      sensible: fila.sensible,
      verificada: evidencia.verificada,
    }));
    return {
      ...this.resumir(fila, sesion),
      resolucion: fila.resolucion,
      descripcion: fila.descripcion,
      reclamante: describirReclamante({ esAnonimo: fila.esAnonimo, nombre: fila.nombre, dni: fila.dni }),
      evidencias: evidenciasDto,
      historial: construirHistorial(historial, fila.canal, fila.ahora),
    };
  }
}
