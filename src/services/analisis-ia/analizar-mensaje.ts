import {
  MARGEN_EMPATE_QUEJA_RECLAMO,
  PISO_PESO_POSIBLE_CORRUPCION_POR_DEFECTO,
  VARIANTE_POR_DEFECTO,
} from "@/constants/analisis-ia.js";
import {
  InformacionFaltanteIa,
  MotivoFalloIa,
  OrigenFundamento,
} from "@/enums/analisis-ia.enum.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { FaltanteCorrupcion } from "@/enums/filtro-corrupcion.enum.js";
import type {
  ContextoAnalisis,
  Fundamento,
  MetricasModelo,
  OpcionesAnalisis,
  PaqueteAnalisis,
} from "@/services/analisis-ia/analisis-ia.types.js";
import { crearClienteOllama } from "@/services/analisis-ia/cliente-ollama.js";
import type { SalidaModelo } from "@/services/analisis-ia/esquema-salida.js";
import { construirPeticion } from "@/services/analisis-ia/prompts.js";
import {
  combinarReglasConIa,
  normalizarPesoIa,
} from "@/services/filtro-corrupcion/combinar-reglas-con-ia.js";
import { evaluarTextoCorrupcion } from "@/services/filtro-corrupcion/evaluar-texto-corrupcion.js";
import type { ResultadoCorrupcion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

const { DENUNCIA_CORRUPCION, QUEJA, RECLAMO, OTRO } = CategoriaIncidencia;

/** Con empate o duda la confianza no pasa de aquí: es una propuesta que decide una persona. */
const CONFIANZA_MAXIMA_CON_DUDA = 55;

const FALTANTE_DE_REGLAS: Readonly<
  Record<FaltanteCorrupcion, InformacionFaltanteIa>
> = {
  [FaltanteCorrupcion.DATOS_INSUFICIENTES]:
    InformacionFaltanteIa.HECHO_DETALLADO,
  [FaltanteCorrupcion.AUTOR_O_CARGO]: InformacionFaltanteIa.AUTOR_O_CARGO,
  [FaltanteCorrupcion.ENTIDAD]: InformacionFaltanteIa.ENTIDAD_O_UNIDAD,
  [FaltanteCorrupcion.PRUEBAS]: InformacionFaltanteIa.PRUEBAS,
};

/** Peso efectivo del modelo: su peso, o el piso si marcó `posible_corrupcion` y se configuró uno. Función pura. */
export function pesoEfectivoDelModelo(
  salida: SalidaModelo,
  piso: number | null,
): number {
  const peso = normalizarPesoIa(salida.peso_corrupcion) ?? 0;
  const pisoUsable = normalizarPesoIa(piso);
  return salida.posible_corrupcion && pisoUsable !== null
    ? Math.max(peso, pisoUsable)
    : peso;
}

/** Queja y reclamo empatados: el modelo da a la otra categoría una probabilidad que difiere de la suya menos que el margen. */
export function hayEmpateQuejaReclamo(salida: SalidaModelo): boolean {
  if (salida.categoria !== QUEJA && salida.categoria !== RECLAMO) return false;
  const otra = salida.categoria === QUEJA ? RECLAMO : QUEJA;
  const probabilidadOtra = salida.alternativas.find(
    (a) => a.categoria === otra,
  )?.probabilidad;
  if (probabilidadOtra === undefined) return false;
  const probabilidadPrincipal =
    salida.alternativas.find((a) => a.categoria === salida.categoria)
      ?.probabilidad ?? 1 - probabilidadOtra;
  return (
    Math.abs(probabilidadPrincipal - probabilidadOtra) <
    MARGEN_EMPATE_QUEJA_RECLAMO
  );
}

const fundamentosDeReglas = (reglas: ResultadoCorrupcion): Fundamento[] =>
  reglas.senales.map((s) => ({
    origen: OrigenFundamento.REGLAS,
    frase: s.frase,
    tipo: s.tipo,
  }));

const fundamentosDelModelo = (salida: SalidaModelo | null): Fundamento[] =>
  (salida?.senales ?? []).map((s) => ({
    origen: OrigenFundamento.MODELO,
    frase: s.frase,
    tipo: s.tipo,
  }));

interface Categoria {
  propuesta: CategoriaIncidencia;
  empate: boolean;
  /** El modelo sospecha corrupción (categoría o marca) pero la suma no la propuso: ante la duda, OTRANS. */
  dudaDeCorrupcion: boolean;
}

/** Categoría final según la combinación, el modelo y las señales sensibles de las reglas. Función pura. */
function decidirCategoria(
  reglas: ResultadoCorrupcion,
  salida: SalidaModelo | null,
  corrupcion: boolean,
): Categoria {
  if (corrupcion)
    return {
      propuesta: DENUNCIA_CORRUPCION,
      empate: false,
      dudaDeCorrupcion: false,
    };
  if (reglas.senalSensible && reglas.categoriaSugerida)
    return {
      propuesta: reglas.categoriaSugerida,
      empate: false,
      dudaDeCorrupcion: false,
    };
  if (!salida)
    return { propuesta: OTRO, empate: false, dudaDeCorrupcion: false };
  if (salida.categoria === DENUNCIA_CORRUPCION)
    return { propuesta: RECLAMO, empate: false, dudaDeCorrupcion: true };
  const empate = hayEmpateQuejaReclamo(salida);
  return {
    propuesta: empate ? RECLAMO : salida.categoria,
    empate,
    dudaDeCorrupcion: salida.posible_corrupcion,
  };
}

/**
 * Análisis completo de un mensaje: reglas, luego el modelo (si el texto aplica) y la combinación. Es una propuesta que una persona
 * confirma: no guarda nada, no registra el texto y nunca lanza por culpa del modelo (si falla, `degradado` y valen solo las reglas).
 * El modelo no decide: su peso se suma al de las reglas y nunca baja un caso que las reglas marcaron.
 */
export async function analizarMensaje(
  texto: string,
  contexto: ContextoAnalisis = {},
  opciones: OpcionesAnalisis = {},
): Promise<PaqueteAnalisis> {
  const variante = opciones.variante ?? VARIANTE_POR_DEFECTO;
  const cliente = opciones.cliente ?? crearClienteOllama();
  // `null` explícito significa "sin piso"; solo `undefined` toma el valor por defecto.
  const piso =
    opciones.pisoPesoPosibleCorrupcion === undefined
      ? PISO_PESO_POSIBLE_CORRUPCION_POR_DEFECTO
      : opciones.pisoPesoPosibleCorrupcion;
  const reglas = evaluarTextoCorrupcion(texto, {
    entidades: contexto.entidades,
    establecimientoConocido: contexto.establecimientoConocido,
    tieneArchivos: contexto.tieneArchivos,
  });

  let salida: SalidaModelo | null = null;
  let metricas: MetricasModelo | null = null;
  let motivo: MotivoFalloIa | null = null;
  if (reglas.aplica) {
    const consulta = await cliente.consultar(
      construirPeticion(variante, texto, reglas, contexto),
    );
    metricas = consulta.metricas;
    if (consulta.ok) salida = consulta.salida;
    else motivo = consulta.motivo;
  }

  const combinacion = combinarReglasConIa(
    reglas,
    salida ? pesoEfectivoDelModelo(salida, piso) : null,
  );
  const categoria = decidirCategoria(
    reglas,
    salida,
    combinacion.propuestaCorrupcion,
  );
  const degradado = reglas.aplica && salida === null;
  const revisionOtrans =
    combinacion.revisionOtrans || categoria.dudaDeCorrupcion;
  const confianza =
    categoria.empate || categoria.dudaDeCorrupcion
      ? Math.min(combinacion.confianza, CONFIANZA_MAXIMA_CON_DUDA)
      : combinacion.confianza;

  return {
    propuesta: categoria.propuesta,
    confianza,
    pesoIa: combinacion.pesoIa,
    explicacion: salida?.explicacion ?? null,
    fundamentos: [
      ...fundamentosDeReglas(reglas),
      ...fundamentosDelModelo(salida),
    ],
    informacionFaltante: salida
      ? [...salida.informacion_faltante]
      : reglas.faltantes.map((f) => FALTANTE_DE_REGLAS[f]),
    fichaDerivacion: reglas.referenciaDerivacion,
    degradado,
    motivoDegradado: degradado ? motivo : null,
    requiereOtrans: combinacion.requiereOtrans,
    revisionOtrans,
    requiereRevisionHumana:
      combinacion.requiereRevisionHumana ||
      categoria.empate ||
      categoria.dudaDeCorrupcion ||
      revisionOtrans,
    escalarAOtrans: reglas.escalarAOtrans,
    senalSensible: reglas.senalSensible,
    empateQuejaReclamo: categoria.empate,
    variante: reglas.aplica ? variante : null,
    reglas,
    combinacion,
    salidaModelo: salida,
    metricas,
  };
}
