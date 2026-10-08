import {
  LONGITUD_MINIMA_TEXTO_CORRUPCION,
  MARCA_DE_HUECO,
  PESO_POR_TIPO,
  TIPOS_DE_SENAL_DE_CORRUPCION,
  UMBRAL_CERTEZA_ALTA,
  UMBRAL_CERTEZA_MEDIA,
  VERSION_REGLAS_CORRUPCION,
} from "@/constants/filtro-corrupcion.js";
import { CertezaCorrupcion, FaltanteCorrupcion, NivelCargo, TipoSenal } from "@/enums/filtro-corrupcion.enum.js";
import {
  buscarCoincidencias,
  compilarPlantilla,
  crearIndice,
  resolverChoques,
  type Coincidencia,
  type EntradaPonderada,
  type Patron,
} from "@/services/filtro-corrupcion/coincidencias.js";
import type {
  ActorDetectado,
  ContextoEvaluacion,
  EntidadCatalogo,
  EntidadDetectada,
  ResultadoCorrupcion,
  SenalDetectada,
} from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";
import {
  CARGOS,
  FRASES_DEBILES,
  FRASES_DE_PRUEBAS,
  FRASES_FUERTES,
  FRASES_MEDIAS,
  FRASES_NEGATIVAS_DECISIVAS,
  FRASES_NEGATIVAS_LEVES,
  PALABRAS_QUE_ENGANAN,
  PALABRAS_QUE_NIEGAN,
} from "@/services/filtro-corrupcion/lexico.js";
import { quitarMontos, tokenizar } from "@/services/filtro-corrupcion/normalizar-texto.js";

interface EntradaDeSenal extends EntradaPonderada {
  tipo: TipoSenal;
}
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
  compilar<EntradaDeSenal>(plantillas, (grupo) => ({ tipo, peso: PESO_POR_TIPO[tipo], grupo }));

const INDICE_DE_SENALES = crearIndice<EntradaDeSenal>([
  ...entradasDeSenal(FRASES_FUERTES, TipoSenal.FUERTE),
  ...entradasDeSenal(FRASES_MEDIAS, TipoSenal.MEDIA),
  ...entradasDeSenal(FRASES_DEBILES, TipoSenal.DEBIL),
  ...entradasDeSenal(FRASES_NEGATIVAS_DECISIVAS, TipoSenal.NEGATIVA_DECISIVA),
  ...entradasDeSenal(FRASES_NEGATIVAS_LEVES, TipoSenal.NEGATIVA_LEVE),
]);

const ENTRADAS_DE_CARGO = CARGOS.flatMap(({ plantilla, nivel }) =>
  compilar<EntradaDeCargo>([plantilla], (grupo) => ({ nivel, peso: PESO_POR_TIPO[TipoSenal.ACTOR], grupo })),
);
const INDICE_DE_CARGOS = crearIndice(ENTRADAS_DE_CARGO);
const INDICE_DE_PRUEBAS = crearIndice(compilar<EntradaPonderada>(FRASES_DE_PRUEBAS, (grupo) => ({ peso: 0, grupo })));

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
  if (c.entrada.tipo !== TipoSenal.NEGATIVA_DECISIVA || c.patron[0] === "no") return false;
  return PALABRAS_QUE_NIEGAN.has(palabras[c.inicio - 1] ?? "");
}

/** Las negativas restan una vez por tipo: dos frases de pago legítimo ("pagué en caja" y "me dieron boleta") son un solo descuento. */
function detectarSenales(palabras: readonly string[]): SenalDetectada[] {
  const encontradas = buscarCoincidencias(palabras, INDICE_DE_SENALES).filter((c) => !esNegativaNegada(c, palabras));
  const negativasVistas = new Set<TipoSenal>();
  return resolverChoques(encontradas)
    .filter((c) => {
      const { tipo } = c.entrada;
      if (tipo !== TipoSenal.NEGATIVA_DECISIVA && tipo !== TipoSenal.NEGATIVA_LEVE) return true;
      if (negativasVistas.has(tipo)) return false;
      negativasVistas.add(tipo);
      return true;
    })
    .map((c) => ({ frase: textoDe(palabras, c), tipo: c.entrada.tipo, peso: c.entrada.peso }));
}

/** El cargo de mayor nivel; a igual nivel, el que aparece primero. */
function detectarActor(palabras: readonly string[]): { actor: ActorDetectado; senal: SenalDetectada } | null {
  const [mejor] = resolverChoques(buscarCoincidencias(palabras, INDICE_DE_CARGOS)).sort(
    (a, b) => PRIORIDAD_DE_CARGO[a.entrada.nivel] - PRIORIDAD_DE_CARGO[b.entrada.nivel] || a.inicio - b.inicio,
  );
  if (!mejor) return null;
  const cargo = textoDe(palabras, mejor);
  return { actor: { cargo, nivel: mejor.entrada.nivel }, senal: { frase: cargo, tipo: TipoSenal.ACTOR, peso: mejor.entrada.peso } };
}

interface EntradaDeEntidad extends EntradaPonderada {
  entidad: EntidadDetectada;
}

function detectarEntidad(
  palabras: readonly string[],
  entidades: readonly EntidadCatalogo[],
): { entidad: EntidadDetectada; senal: SenalDetectada } | null {
  const entradas = entidades.flatMap(({ codigo, nombre, alias = [] }) =>
    [nombre, ...alias]
      .map((texto) => tokenizar(texto))
      .filter((patron) => patron.length > 0)
      .map((patron) => ({
        patron,
        entrada: { entidad: { codigo, nombre }, peso: PESO_POR_TIPO[TipoSenal.ENTIDAD], grupo: codigo } satisfies EntradaDeEntidad,
      })),
  );
  const [mejor] = buscarCoincidencias(palabras, crearIndice(entradas)).sort((a, b) => a.inicio - b.inicio || b.fin - a.fin);
  if (!mejor) return null;
  return { entidad: mejor.entrada.entidad, senal: { frase: textoDe(palabras, mejor), tipo: TipoSenal.ENTIDAD, peso: mejor.entrada.peso } };
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

function certezaDe(puntaje: number, propuestaCorrupcion: boolean): CertezaCorrupcion {
  if (!propuestaCorrupcion) return CertezaCorrupcion.BAJA;
  return puntaje >= UMBRAL_CERTEZA_ALTA ? CertezaCorrupcion.ALTA : CertezaCorrupcion.MEDIA;
}

/**
 * Filtro de corrupción v1 por reglas (sin IA, sin base de datos, sin red). Suma señales del léxico, el actor y la
 * entidad, y resta las negativas; devuelve una PROPUESTA con su certeza. Quien revisa siempre confirma o corrige, y el
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
      faltantes: [FaltanteCorrupcion.DATOS_INSUFICIENTES],
      versionReglas: VERSION_REGLAS_CORRUPCION,
    };
  }

  const palabras = quitarMontos(tokenizar(recortado));
  const actor = detectarActor(palabras);
  const entidad = detectarEntidad(palabras, contexto.entidades ?? []);
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
    faltantes,
    versionReglas: VERSION_REGLAS_CORRUPCION,
  };
}
