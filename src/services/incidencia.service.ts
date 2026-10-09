import type { Env } from "@/config/env.js";
import {
  CATEGORIA_API,
  CATEGORIA_DESDE_API,
  CATEGORIA_ETIQUETA,
  CONTEO_TOPE,
  ESTADO_API,
  type EstadoApi,
  ESTADO_DESDE_API,
  POR_VENCER_LISTA_MAXIMA,
  SIN_CATEGORIA_API,
} from "@/constants/incidencias.js";
import {
  MENSAJE_ACCION_NO_PERMITIDA,
  MENSAJE_ACCION_REALIZADA,
  MENSAJE_AREA_DESTINO_INVALIDA,
  MENSAJE_CASO_NO_ENCONTRADO,
  MENSAJE_CATEGORIA_NO_PERMITIDA,
  MENSAJE_FALTA_CATEGORIA,
  MENSAJE_FALTA_MOTIVO_DE_ARCHIVO,
  MENSAJE_FALTA_MOTIVO_DE_REAPERTURA,
  MENSAJE_FALTA_RESOLUCION,
  MENSAJE_MISMA_CATEGORIA,
  MENSAJE_SIN_DESTINO_DE_DERIVACION,
  mensajeCategoriaCorregidaFueraDeVista,
} from "@/constants/mensajes-incidencias.js";
import { actorUsuarioInterno } from "@/database/actor.js";
import type { Database, DbExecutor } from "@/database/database.js";
import { traducirErrorDeBase } from "@/database/reglas-de-la-base.js";
import { AccionIncidencia } from "@/enums/accion-incidencia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import { TipoArea } from "@/enums/tipo-area.enum.js";
import { AppError } from "@/errors/app-error.js";
import {
  type FilaCaso,
  type FiltrosDeListado,
  type IncidenciaRepository,
  type VisibilidadCasos,
  sinEstadoNiMotivo,
} from "@/repositories/incidencia.repository.js";
import { accionesPermitidas, categoriasParaCorregir, reglasDeAvisos, veCasosSinCategoria } from "@/utils/acciones-permitidas.js";
import { codificarCursor } from "@/utils/cursor-listado.js";
import { construirHistorial } from "@/utils/historial-incidencia.js";
import { calcularPlazo, horasEntre, type PlazosConfigurados } from "@/utils/plazo-incidencia.js";
import { describirReclamante } from "@/utils/reclamante.js";
import type { SesionActual } from "./auth.types.js";
import type {
  CasoDetalleDto,
  CasoEnviadoAOtransDto,
  CasoResumenDto,
  ConsultaListado,
  ConteoAcotadoDto,
  ConteosDto,
  DatosAccion,
  EvidenciaDto,
  FiltrosConsulta,
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

export function visibilidadDe(sesion: SesionActual): VisibilidadCasos {
  return { roles: sesion.roles, verSinCategoria: veCasosSinCategoria(sesion.roles), areaId: sesion.area?.id ?? null };
}

function filtrosDe(consulta: FiltrosConsulta): FiltrosDeListado {
  const filtros: FiltrosDeListado = {};
  if (consulta.estado) filtros.estado = ESTADO_DESDE_API[consulta.estado];
  if (consulta.categoria === SIN_CATEGORIA_API) filtros.sinCategoria = true;
  else if (consulta.categoria) filtros.categoria = CATEGORIA_DESDE_API[consulta.categoria];
  if (consulta.texto) filtros.texto = consulta.texto;
  if (consulta.establecimiento) filtros.establecimiento = consulta.establecimiento;
  if (consulta.motivoArchivo) filtros.motivoArchivo = consulta.motivoArchivo;
  if (consulta.desde) filtros.desde = consulta.desde;
  if (consulta.hasta) filtros.hasta = consulta.hasta;
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
    private readonly topeDeConteo: number = CONTEO_TOPE,
  ) {}

  /**
   * Contadores de las pestañas de la bandeja. Cada uno cuenta como mucho `topeDeConteo` casos y avisa con `conMas` si hay
   * más. `todos` y `porEstado` ignoran `estado` y `motivoArchivo` (así cada pestaña muestra su cantidad real bajo los demás
   * filtros); `total` los aplica y es la cantidad que muestra el listado con esos mismos filtros.
   */
  async conteos(sesion: SesionActual, consulta: FiltrosConsulta): Promise<ConteosDto> {
    const visible = visibilidadDe(sesion);
    const filtros = filtrosDe(consulta);
    const deLasPestanas = sinEstadoNiMotivo(filtros);
    const acotaPestana = filtros.estado !== undefined || filtros.motivoArchivo !== undefined;
    const tope = this.topeDeConteo;
    const [porEstado, total] = await Promise.all([
      this.casos.contarPorEstado(visible, deLasPestanas, tope),
      acotaPestana ? this.casos.contarAcotado(visible, filtros, tope) : null,
    ]);
    // Cada estado llega contado hasta tope + 1: la suma supera el tope exactamente cuando los casos de todos los estados lo superan.
    const todos = [...porEstado.values()].reduce((suma, cantidad) => suma + cantidad, 0);
    const acotar = (cantidad: number): ConteoAcotadoDto => ({ cantidad: Math.min(cantidad, tope), conMas: cantidad > tope });
    return {
      todos: acotar(todos),
      total: acotar(total ?? todos),
      porEstado: Object.fromEntries(
        Object.values(EstadoIncidencia).map((estado) => [ESTADO_API[estado], acotar(porEstado.get(estado) ?? 0)]),
      ) as Record<EstadoApi, ConteoAcotadoDto>,
    };
  }

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

  async ejecutar(
    sesion: SesionActual,
    codigo: string,
    accion: AccionIncidencia,
    datos: DatosAccion,
  ): Promise<ResultadoAccionDto | CasoEnviadoAOtransDto> {
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
        await this.aplicar(tx, sesion, fila, accion, datos);
      });
    } catch (error) {
      throw traducirErrorDeBase(error);
    }

    const actualizado = await this.casos.buscarPorCodigo(codigo, visible);
    if (actualizado) {
      return { mensaje: MENSAJE_ACCION_REALIZADA[accion], caso: await this.detallar(actualizado, sesion) };
    }
    const nueva = datos.categoria ? CATEGORIA_DESDE_API[datos.categoria] : null;
    // Corrupción que se escapó a un establecimiento: la base la manda a OTRANS y ya no es de quien la corrigió. Sin datos del caso.
    if (accion === AccionIncidencia.CORREGIR && nueva === CategoriaIncidencia.DENUNCIA_CORRUPCION) {
      return { codigo, enviadoAOtrans: true };
    }
    const mensaje =
      accion === AccionIncidencia.CORREGIR && nueva
        ? mensajeCategoriaCorregidaFueraDeVista(CATEGORIA_ETIQUETA[nueva])
        : MENSAJE_ACCION_REALIZADA[accion];
    return { mensaje, caso: null };
  }

  private async aplicar(tx: DbExecutor, sesion: SesionActual, fila: FilaCaso, accion: AccionIncidencia, datos: DatosAccion): Promise<void> {
    switch (accion) {
      case AccionIncidencia.CONFIRMAR:
        return this.casos.confirmar(tx, fila.id);
      case AccionIncidencia.CORREGIR: {
        if (!datos.categoria) throw new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, MENSAJE_FALTA_CATEGORIA);
        const nueva = CATEGORIA_DESDE_API[datos.categoria];
        const alcanzables = categoriasParaCorregir(sesion.roles, { estado: fila.estado, categoria: fila.categoria, revisada: fila.revisada });
        if (!alcanzables.includes(nueva)) throw new AppError(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, MENSAJE_CATEGORIA_NO_PERMITIDA);
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
        const { medidasTomadas, fundamento, resultado } = datos;
        if (!medidasTomadas || !fundamento || !resultado) {
          throw new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, MENSAJE_FALTA_RESOLUCION);
        }
        return this.casos.resolver(tx, fila.id, { medidasTomadas, fundamento, resultado });
      }
      case AccionIncidencia.ARCHIVAR: {
        if (!datos.motivoArchivo || !datos.detalle) {
          throw new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, MENSAJE_FALTA_MOTIVO_DE_ARCHIVO);
        }
        return this.casos.archivar(tx, fila.id, { motivo: datos.motivoArchivo, detalle: datos.detalle });
      }
      case AccionIncidencia.REABRIR: {
        if (!datos.motivoReapertura) {
          throw new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, MENSAJE_FALTA_MOTIVO_DE_REAPERTURA);
        }
        return this.casos.reabrir(tx, fila.id, datos.motivoReapertura);
      }
    }
  }

  /**
   * El área elegida por la persona o, si no eligió, la de origen: el establecimiento de origen del caso; en una denuncia
   * por corrupción, el área donde ya está (OTRANS). Siempre activa y del tipo que recibe el caso.
   */
  private async areaDeDerivacion(tx: DbExecutor, fila: FilaCaso, datos: DatosAccion): Promise<number> {
    const sensible = fila.categoria === CategoriaIncidencia.DENUNCIA_CORRUPCION;
    const porDefecto = sensible ? fila.areaDestinoId : fila.areaOrigenId;
    if (!datos.areaDestino && porDefecto === null) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.UNPROCESSABLE, MENSAJE_SIN_DESTINO_DE_DERIVACION);
    }
    const criterio = datos.areaDestino ? { codigo: datos.areaDestino } : { id: porDefecto as number };
    const areaId = await this.casos.areaReceptora(criterio, sensible ? TipoArea.OTRANS : TipoArea.ESTABLECIMIENTO, tx);
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
        { estado: fila.estado, fechaCreacion: fila.fechaCreacion, reabiertoEn: fila.reabiertoEn, resueltoEn: fila.resueltoEn, ahora: fila.ahora },
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
      resolucion:
        fila.medidasTomadas !== null && fila.fundamento !== null && fila.resultadoResolucion !== null
          ? { medidasTomadas: fila.medidasTomadas, fundamento: fila.fundamento, resultado: fila.resultadoResolucion }
          : null,
      archivo:
        fila.motivoArchivo !== null && fila.archivadoEn !== null
          ? { motivo: fila.motivoArchivo, detalle: fila.archivoDetalle, archivadoEn: fila.archivadoEn.toISOString() }
          : null,
      reapertura:
        fila.reabiertoEn !== null && fila.reabiertoMotivo !== null
          ? { reabiertoEn: fila.reabiertoEn.toISOString(), motivo: fila.reabiertoMotivo }
          : null,
      descripcion: fila.descripcion,
      reclamante: describirReclamante({ esAnonimo: fila.esAnonimo, nombre: fila.nombre, dni: fila.dni }),
      evidencias: evidenciasDto,
      historial: construirHistorial(historial, fila.canal, fila.ahora),
    };
  }
}
