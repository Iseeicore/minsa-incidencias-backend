import {
  LONGITUD_MINIMA_TEXTO_CORRUPCION,
  MARCA_DE_HUECO,
  PALABRAS_SEGUIDAS_PARA_NOMBRE,
  PESO_POR_TIPO,
  TIPOS_DE_SENAL_DE_CORRUPCION,
  TITULOS_ESTANDAR_DEL_CARGO_MAXIMO,
  UMBRAL_CERTEZA_ALTA,
  UMBRAL_CERTEZA_MEDIA,
  VENTANA_DE_NEGACION,
  VERSION_REGLAS_CORRUPCION,
} from "@/constants/filtro-corrupcion.js";
import { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import {
  CertezaCorrupcion,
  FaltanteCorrupcion,
  NivelCargo,
  SenalSensible,
  TipoContacto,
  TipoSenal,
} from "@/enums/filtro-corrupcion.enum.js";
import { CLASES } from "@/services/filtro-corrupcion/clases-lexico.js";
import { CATALOGO_ENTIDADES } from "@/services/filtro-corrupcion/catalogo-entidades.data.js";
import {
  buscarCoincidencias,
  compilarPlantilla,
  crearIndice,
  resolverChoques,
  type Coincidencia,
  type EntradaPonderada,
  type IndicePorPrimeraPalabra,
  type Patron,
} from "@/services/filtro-corrupcion/coincidencias.js";
import type {
  ActorDetectado,
  ContextoEvaluacion,
  EntidadCatalogo,
  EntidadDetectada,
  ReferenciaDerivacion,
  ResultadoCorrupcion,
  SenalDetectada,
  TitularDetectado,
} from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";
import {
  CARGOS,
  FRASES_DE_ACOSO,
  FRASES_DEBILES,
  FRASES_DE_PRUEBAS,
  FRASES_FUERTES,
  FRASES_MEDIAS,
  FRASES_NEGATIVAS_DECISIVAS,
  FRASES_NEGATIVAS_LEVES,
  INICIOS_QUE_YA_NIEGAN,
  NEGADORES_DE_COBRO,
  NEGADORES_DENTRO_DEL_COBRO,
  PALABRAS_DE_JEFATURA,
  PALABRAS_QUE_ENGANAN,
  PALABRAS_QUE_NIEGAN,
  PLANTILLAS_DE_LA_FAMILIA_DE_COBRO,
} from "@/services/filtro-corrupcion/lexico.js";
import { FRASES_DEBILES_DE_COBRO, FRASES_FUERTES_DE_COBRO, FRASES_MEDIAS_DE_COBRO } from "@/services/filtro-corrupcion/lexico-cobro.js";
import { marcarMontos, tokenizar } from "@/services/filtro-corrupcion/normalizar-texto.js";

interface EntradaDeSenal extends EntradaPonderada {
  tipo: TipoSenal;
  /** Una negación delante ("no me pidió plata") la anula. Solo los patrones generalizables de cobro. */
  negable: boolean;
}

const FAMILIA_DE_COBRO = "cobro";
interface EntradaDeCargo extends EntradaPonderada {
  nivel: NivelCargo;
}
interface Compilada<T> {
  patron: Patron;
  entrada: T;
}

const esPalabraQueEngana = (patron: Patron): boolean => patron.length === 1 && PALABRAS_QUE_ENGANAN.has(patron[0] ?? "");

function compilar<T extends EntradaPonderada>(plantillas: readonly string[], entradaDe: (plantilla: string) => T): Compilada<T>[] {
  return plantillas.flatMap((plantilla) =>
    compilarPlantilla(plantilla)
      .filter((patron) => !esPalabraQueEngana(patron))
      .map((patron) => ({ patron, entrada: entradaDe(plantilla) })),
  );
}

const entradasDeSenal = (plantillas: readonly string[], tipo: TipoSenal) =>
  compilar<EntradaDeSenal>(plantillas, (grupo) => ({
    tipo,
    peso: PESO_POR_TIPO[tipo],
    grupo,
    negable: false,
    familia: PLANTILLAS_DE_LA_FAMILIA_DE_COBRO.has(grupo) ? FAMILIA_DE_COBRO : undefined,
  }));

/** Los patrones generalizables de cobro: todos de la familia de cobro y anulados por una negación. */
const entradasGeneralizadas = (plantillas: readonly string[], tipo: TipoSenal) =>
  compilar<EntradaDeSenal>(plantillas, (grupo) => ({
    tipo,
    peso: PESO_POR_TIPO[tipo],
    grupo,
    negable: true,
    familia: FAMILIA_DE_COBRO,
  }));

const INDICE_DE_SENALES = crearIndice<EntradaDeSenal>([
  ...entradasDeSenal(FRASES_FUERTES, TipoSenal.FUERTE),
  ...entradasDeSenal(FRASES_MEDIAS, TipoSenal.MEDIA),
  ...entradasDeSenal(FRASES_DEBILES, TipoSenal.DEBIL),
  ...entradasGeneralizadas(FRASES_FUERTES_DE_COBRO, TipoSenal.FUERTE),
  ...entradasGeneralizadas(FRASES_MEDIAS_DE_COBRO, TipoSenal.MEDIA),
  ...entradasGeneralizadas(FRASES_DEBILES_DE_COBRO, TipoSenal.DEBIL),
  ...entradasDeSenal(FRASES_NEGATIVAS_DECISIVAS, TipoSenal.NEGATIVA_DECISIVA),
  ...entradasDeSenal(FRASES_NEGATIVAS_LEVES, TipoSenal.NEGATIVA_LEVE),
]);

const INDICE_DE_ACOSO = crearIndice(compilar<EntradaPonderada>(FRASES_DE_ACOSO, (grupo) => ({ peso: 0, grupo })));
const VERBOS_DE_COBRO: ReadonlySet<string> = new Set([...(CLASES.get("verbo_cobro") ?? []), "cobro", "solicito"]);

const ENTRADAS_DE_CARGO = CARGOS.flatMap(({ plantilla, nivel }) =>
  compilar<EntradaDeCargo>([plantilla], (grupo) => ({
    nivel,
    peso: PESO_POR_TIPO[TipoSenal.ACTOR],
    grupo,
  })),
);
const INDICE_DE_CARGOS = crearIndice(ENTRADAS_DE_CARGO);
const INDICE_DE_PRUEBAS = crearIndice(
  compilar<EntradaPonderada>(FRASES_DE_PRUEBAS, (grupo) => ({
    peso: 0,
    grupo,
  })),
);

const PRIORIDAD_DE_CARGO: Record<NivelCargo, number> = {
  [NivelCargo.CARGO_MAXIMO]: 0,
  [NivelCargo.CARGO_DE_LINEA]: 1,
  [NivelCargo.PERSONAL]: 2,
};

/** Palabras que acompañan a un cargo ("el director Juan Pérez") y no son parte del nombre. */
const PALABRAS_DE_CARGO = new Set([
  ...ENTRADAS_DE_CARGO.flatMap(({ patron }) => patron.filter((palabra) => palabra !== MARCA_DE_HUECO)),
  "el",
  "la",
  "los",
  "las",
  "mi",
  "su",
  "un",
  "una",
  "dr",
  "dra",
  "sr",
  "sra",
]);

const NOMBRE_PROPIO = /\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+/gu;

const textoDe = (palabras: readonly string[], c: { inicio: number; fin: number }): string => palabras.slice(c.inicio, c.fin).join(" ");

/** Un pago legítimo negado ("no me dieron boleta") no resta. */
function esNegativaNegada(c: Coincidencia<EntradaDeSenal>, palabras: readonly string[]): boolean {
  if (c.entrada.tipo !== TipoSenal.NEGATIVA_DECISIVA || INICIOS_QUE_YA_NIEGAN.has(c.patron[0] ?? "")) return false;
  return PALABRAS_QUE_NIEGAN.has(palabras[c.inicio - 1] ?? "");
}

/** Una frase de cobro negada ("no me pidió plata", "nadie me cobró", "no me condicionó ningún pago") no cuenta como señal. */
function estaNegadaLaFrase(inicio: number, fin: number, palabras: readonly string[]): boolean {
  const antes = palabras.slice(Math.max(0, inicio - VENTANA_DE_NEGACION), inicio);
  return (
    antes.some((palabra) => NEGADORES_DE_COBRO.has(palabra)) ||
    palabras.slice(inicio, fin).some((palabra) => NEGADORES_DENTRO_DEL_COBRO.has(palabra))
  );
}

/** Las negativas restan una vez por tipo: dos frases de pago legítimo ("pagué en caja" y "me dieron boleta") son un solo descuento. */
function detectarSenales(palabras: readonly string[]): SenalDetectada[] {
  const encontradas = buscarCoincidencias(palabras, INDICE_DE_SENALES).filter(
    (c) => !esNegativaNegada(c, palabras) && !(c.entrada.negable && estaNegadaLaFrase(c.inicio, c.fin, palabras)),
  );
  const negativasVistas = new Set<TipoSenal>();
  return resolverChoques(encontradas)
    .filter((c) => {
      const { tipo } = c.entrada;
      if (tipo !== TipoSenal.NEGATIVA_DECISIVA && tipo !== TipoSenal.NEGATIVA_LEVE) return true;
      if (negativasVistas.has(tipo)) return false;
      negativasVistas.add(tipo);
      return true;
    })
    .map((c) => ({
      frase: textoDe(palabras, c),
      tipo: c.entrada.tipo,
      peso: c.entrada.peso,
    }));
}

/** El cargo de mayor nivel; a igual nivel, el que aparece primero. */
function detectarActor(palabras: readonly string[]): { actor: ActorDetectado; senal: SenalDetectada } | null {
  const [mejor] = resolverChoques(buscarCoincidencias(palabras, INDICE_DE_CARGOS)).sort(
    (a, b) => PRIORIDAD_DE_CARGO[a.entrada.nivel] - PRIORIDAD_DE_CARGO[b.entrada.nivel] || a.inicio - b.inicio,
  );
  if (!mejor) return null;
  const cargo = textoDe(palabras, mejor);
  return {
    actor: { cargo, nivel: mejor.entrada.nivel },
    senal: { frase: cargo, tipo: TipoSenal.ACTOR, peso: mejor.entrada.peso },
  };
}

interface EntradaDeEntidad extends EntradaPonderada {
  entidad: EntidadCatalogo;
}
interface IndiceDeEntidades {
  entradas: readonly { patron: Patron; entrada: EntradaDeEntidad }[];
  indice: IndicePorPrimeraPalabra<EntradaDeEntidad>;
}

const PARTICULAS_DE_NOMBRE = new Set(["de", "del", "la", "las", "los", "y"]);

const INDICES_POR_CATALOGO = new WeakMap<readonly EntidadCatalogo[], IndiceDeEntidades>();

/** El nombre y cada alias de cada entidad, como secuencias de palabras; se arma una vez por catálogo. */
function indiceDeEntidades(entidades: readonly EntidadCatalogo[]): IndiceDeEntidades {
  const guardado = INDICES_POR_CATALOGO.get(entidades);
  if (guardado) return guardado;
  const entradas = entidades.flatMap((entidad) =>
    [entidad.nombre, ...(entidad.alias ?? [])]
      .map((texto) => tokenizar(texto))
      .filter((patron) => patron.length > 0)
      .map((patron) => ({
        patron,
        entrada: {
          entidad,
          peso: PESO_POR_TIPO[TipoSenal.ENTIDAD],
          grupo: entidad.codigo,
        } satisfies EntradaDeEntidad,
      })),
  );
  const creado = { entradas, indice: crearIndice(entradas) };
  INDICES_POR_CATALOGO.set(entidades, creado);
  return creado;
}

/**
 * Una coincidencia es ambigua si el texto sigue con la siguiente palabra de otra entidad cuyo nombre empieza igual:
 * "Instituto Nacional de Salud del Niño" calza con el INS, pero también arranca el nombre de dos institutos del niño.
 * En ese caso no se elige ninguna (no se adivina).
 */
function esAmbigua(c: Coincidencia<EntradaDeEntidad>, palabras: readonly string[], todas: IndiceDeEntidades["entradas"]): boolean {
  const siguiente = palabras[c.fin];
  if (siguiente === undefined) return false;
  return todas.some(
    ({ patron, entrada }) =>
      entrada.entidad.codigo !== c.entrada.entidad.codigo &&
      patron.length > c.patron.length &&
      patron[c.patron.length] === siguiente &&
      c.patron.every((palabra, i) => patron[i] === palabra),
  );
}

/**
 * Entidad del catálogo mencionada: la que aparece primero (a igual inicio, la de nombre más largo). "Ministerio" suelto no
 * es el MINSA (puede ser cualquier ministerio): solo "ministerio de salud" o "minsa". Las siglas que son palabras comunes
 * ("DIRIS LE") no son alias: se usa "DIRIS Lima Este".
 */
function detectarEntidad(
  palabras: readonly string[],
  entidades: readonly EntidadCatalogo[],
): {
  entidad: EntidadDetectada;
  catalogo: EntidadCatalogo;
  senal: SenalDetectada;
} | null {
  const { entradas, indice } = indiceDeEntidades(entidades);
  const [mejor] = buscarCoincidencias(palabras, indice)
    .filter((c) => !esAmbigua(c, palabras, entradas))
    .sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
  if (!mejor) return null;
  const { codigo, nombre, tipo = null } = mejor.entrada.entidad;
  return {
    entidad: { codigo, nombre, tipo },
    catalogo: mejor.entrada.entidad,
    senal: {
      frase: textoDe(palabras, mejor),
      tipo: TipoSenal.ENTIDAD,
      peso: mejor.entrada.peso,
    },
  };
}

/** El texto nombra al titular: al menos dos palabras seguidas del nombre registrado (sin tildes ni mayúsculas). Solo informativo. */
function mencionaAlTitular(palabras: readonly string[], nombreTitular: string | null | undefined): boolean {
  if (!nombreTitular) return false;
  const propias = new Set(tokenizar(nombreTitular).filter((palabra) => !PARTICULAS_DE_NOMBRE.has(palabra)));
  let racha = 0;
  for (const palabra of palabras) {
    racha = propias.has(palabra) ? racha + 1 : 0;
    if (racha >= PALABRAS_SEGUIDAS_PARA_NOMBRE) return true;
  }
  return false;
}

/** Titular = cargo máximo (o su equivalente). El nombre que coincide nunca entra al puntaje: es un dato para quien revisa. */
function detectarTitular(
  actor: ActorDetectado | null,
  catalogo: EntidadCatalogo | undefined,
  palabras: readonly string[],
): TitularDetectado | null {
  if (actor?.nivel !== NivelCargo.CARGO_MAXIMO) return null;
  return {
    cargo: actor.cargo,
    esEquivalenteDelMaximo: !TITULOS_ESTANDAR_DEL_CARGO_MAXIMO.has(actor.cargo),
    nombreCoincide: mencionaAlTitular(palabras, catalogo?.titular?.nombre),
  };
}

/**
 * Qué contactos de derivación tiene la entidad en el catálogo y a dónde va la denuncia contra su titular (la ficha completa es
 * otra fase). El destino se informa siempre que la fuente lo traiga; `aplicaAlTitular` dice si el texto señala al titular.
 */
function referenciaDe(catalogo: EntidadCatalogo, titular: TitularDetectado | null): ReferenciaDerivacion {
  const destino = catalogo.destinoSiTitular ?? null;
  return {
    codigoEntidad: catalogo.codigo,
    contactosDisponibles: Object.values(TipoContacto).filter((tipo) => catalogo.contactos?.[tipo] != null),
    destinoSiTitular: destino,
    aplicaAlTitular: destino !== null && titular !== null,
  };
}

/** Nombre propio (dos o más palabras con mayúscula inicial) que no sea un cargo. Solo informativo: no entra al puntaje. */
function detectarNombreMencionado(texto: string): string | null {
  for (const candidato of texto.match(NOMBRE_PROPIO) ?? []) {
    const palabras = candidato.split(/\s+/);
    while (palabras.length > 0 && PALABRAS_DE_CARGO.has(tokenizar(palabras[0] ?? "").join(" "))) palabras.shift();
    if (palabras.length >= 2) return palabras.join(" ");
  }
  return null;
}

const esJefatura = (palabras: readonly string[]): boolean => palabras.some((palabra) => PALABRAS_DE_JEFATURA.has(palabra));

/** Hay un verbo de cobro ("pide", "cobra", "exige"...) que nadie niega: basta para la zona gris, aunque no cierre una frase del léxico. */
function hayVerboDeCobro(palabras: readonly string[]): boolean {
  return palabras.some((palabra, i) => VERBOS_DE_COBRO.has(palabra) && !estaNegadaLaFrase(i, i + 1, palabras));
}

/**
 * Zona gris (decisión del 2026-10-08): entidad del catálogo + su titular o un cargo de jefatura + verbo de cobro, y las reglas no
 * confirman corrupción. No propone nada: solo pide segunda opinión (IA, o OTRANS si la IA no está).
 */
function esZonaGris(
  propuestaCorrupcion: boolean,
  hayEntidad: boolean,
  titular: TitularDetectado | null,
  actor: ActorDetectado | null,
  palabras: readonly string[],
): boolean {
  if (propuestaCorrupcion || !hayEntidad) return false;
  const nombraJefatura = titular !== null || actor?.nivel === NivelCargo.CARGO_MAXIMO || esJefatura(palabras);
  return nombraJefatura && hayVerboDeCobro(palabras);
}

interface AcosoDetectado {
  senalSensible: SenalSensible | null;
  categoriaSugerida: CategoriaIncidencia | null;
  escalarAOtrans: boolean;
}

const SIN_ACOSO: AcosoDetectado = {
  senalSensible: null,
  categoriaSugerida: null,
  escalarAOtrans: false,
};

/** Acoso, hostigamiento o tocamientos: aparte del puntaje de corrupción. Escala a OTRANS si acusa a un cargo mayor o a un titular. */
function detectarAcoso(palabras: readonly string[], actor: ActorDetectado | null, titular: TitularDetectado | null): AcosoDetectado {
  const hayAcoso = buscarCoincidencias(palabras, INDICE_DE_ACOSO).some((c) => !estaNegadaLaFrase(c.inicio, c.fin, palabras));
  if (!hayAcoso) return SIN_ACOSO;
  const cargoMayor = titular !== null || actor?.nivel === NivelCargo.CARGO_MAXIMO || esJefatura(palabras);
  return {
    senalSensible: SenalSensible.ACOSO,
    categoriaSugerida: CategoriaIncidencia.RECLAMO,
    escalarAOtrans: cargoMayor,
  };
}

function certezaDe(puntaje: number, propuestaCorrupcion: boolean): CertezaCorrupcion {
  if (!propuestaCorrupcion) return CertezaCorrupcion.BAJA;
  return puntaje >= UMBRAL_CERTEZA_ALTA ? CertezaCorrupcion.ALTA : CertezaCorrupcion.MEDIA;
}

/**
 * Filtro de corrupción v1.2 por reglas (sin IA, sin base de datos, sin red). Suma señales del léxico, el actor y la
 * entidad del catálogo (por defecto el oficial generado en `catalogo-entidades.data.ts`), y resta las negativas; devuelve una PROPUESTA con su certeza. Quien revisa siempre confirma o corrige, y el
 * destino de la incidencia no sale de aquí. Sin ninguna señal de corrupción (fuerte, media o débil) nunca se propone
 * corrupción, aunque el actor y la entidad sumen.
 */
export function evaluarTextoCorrupcion(texto: string, contexto: ContextoEvaluacion = {}): ResultadoCorrupcion {
  const recortado = texto.trim();
  if (recortado.length < LONGITUD_MINIMA_TEXTO_CORRUPCION) {
    return {
      aplica: false,
      puntaje: 0,
      certeza: CertezaCorrupcion.BAJA,
      propuestaCorrupcion: false,
      senales: [],
      actor: null,
      nombreMencionado: null,
      entidad: null,
      titular: null,
      faltantes: [FaltanteCorrupcion.DATOS_INSUFICIENTES],
      requiereOtrans: false,
      referenciaDerivacion: null,
      requiereSegundaOpinion: false,
      ...SIN_ACOSO,
      versionReglas: VERSION_REGLAS_CORRUPCION,
    };
  }

  const palabras = marcarMontos(tokenizar(recortado));
  const actor = detectarActor(palabras);
  const entidad = detectarEntidad(palabras, contexto.entidades ?? CATALOGO_ENTIDADES);
  const titular = detectarTitular(actor?.actor ?? null, entidad?.catalogo, palabras);
  const nombreMencionado = detectarNombreMencionado(recortado);
  const senales = [...detectarSenales(palabras), ...(actor ? [actor.senal] : []), ...(entidad ? [entidad.senal] : [])];

  const puntaje = senales.reduce((suma, { peso }) => suma + peso, 0);
  const hayEvidencia = senales.some(({ tipo }) => TIPOS_DE_SENAL_DE_CORRUPCION.includes(tipo));
  const propuestaCorrupcion = hayEvidencia && puntaje >= UMBRAL_CERTEZA_MEDIA;

  const faltantes: FaltanteCorrupcion[] = [];
  if (propuestaCorrupcion) {
    if (!actor && !nombreMencionado) faltantes.push(FaltanteCorrupcion.AUTOR_O_CARGO);
    if (!entidad && !contexto.establecimientoConocido) faltantes.push(FaltanteCorrupcion.ENTIDAD);
    if (!contexto.tieneArchivos && buscarCoincidencias(palabras, INDICE_DE_PRUEBAS).length === 0)
      faltantes.push(FaltanteCorrupcion.PRUEBAS);
  }

  return {
    aplica: true,
    puntaje,
    certeza: certezaDe(puntaje, propuestaCorrupcion),
    propuestaCorrupcion,
    senales,
    actor: actor?.actor ?? null,
    nombreMencionado,
    entidad: entidad?.entidad ?? null,
    titular,
    faltantes,
    requiereOtrans: propuestaCorrupcion,
    referenciaDerivacion: propuestaCorrupcion && entidad ? referenciaDe(entidad.catalogo, titular) : null,
    requiereSegundaOpinion: esZonaGris(propuestaCorrupcion, entidad !== null, titular, actor?.actor ?? null, palabras),
    ...detectarAcoso(palabras, actor?.actor ?? null, titular),
    versionReglas: VERSION_REGLAS_CORRUPCION,
  };
}
