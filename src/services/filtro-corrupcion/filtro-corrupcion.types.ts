import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import type {
  AcuerdoReglasIa,
  CertezaCorrupcion,
  FaltanteCorrupcion,
  HuecoCatalogo,
  NivelCargo,
  OrigenPropuesta,
  SenalSensible,
  TipoContacto,
  TipoEntidad,
  TipoSenal,
  ViaEntidad,
} from "@/enums/filtro-corrupcion.enum.js";

/** Una persona de contacto tal como figura en el directorio de la entidad. `null` en el correo: el directorio no lo muestra. */
export interface Contacto {
  nombre: string;
  cargo: string;
  correo: string | null;
}

/** Contactos de derivación de una entidad; `null` = el cargo no figura en el directorio (no que no exista). */
export type ContactosEntidad = Readonly<Record<TipoContacto, readonly Contacto[] | null>>;

/** Titular de la entidad (nota del catálogo, sección 1). El nombre rota: solo se compara como señal informativa. */
export interface TitularCatalogo {
  /** Cargo oficial como figura en gob.pe. */
  cargo: string;
  /** Otros títulos que cuentan como cargo máximo de la entidad (decisión del 2026-10-07). */
  cargosEquivalentes: readonly string[];
  nombre: string | null;
}

/** A dónde va la denuncia contra el titular de la entidad (columna "Destino si la denuncia es contra el titular" de la lista oficial). */
export interface DestinoSiTitular {
  /** Texto tal cual de la fuente, p. ej. "SIS (Sistema Integrado de Salud, según la nota (2*) de la lista)". */
  texto: string;
  /**
   * `codigo` de la entidad del catálogo a la que apunta, o el código de destino especial `st-pad-minsa` (ST PAD MINSA no es una
   * entidad del catálogo: es un órgano del MINSA). `null` si el destino es solo texto.
   */
  entidadDestinoCodigo: string | null;
}

/**
 * Una entidad del catálogo (plan de cierre, paso 2). El nombre y los alias se buscan como secuencias de palabras. Solo
 * `codigo`, `nombre` y `alias` son obligatorios para buscar: un catálogo recibido por la ruta puede no traer el resto.
 */
export interface EntidadCatalogo {
  codigo: string;
  nombre: string;
  tipo?: TipoEntidad;
  alias?: readonly string[];
  /** Variantes generadas del nombre oficial y la sigla (sin "Hospital"/"Nacional"/"de", con artículo, con faltas de ortografía). Se buscan igual que `alias`. */
  aliasDerivados?: readonly string[];
  titular?: TitularCatalogo | null;
  /** `null` o ausente: la fuente no trae destino para esta entidad (no se inventa). */
  destinoSiTitular?: DestinoSiTitular | null;
  contactos?: ContactosEntidad | null;
  huecos?: readonly HuecoCatalogo[];
}

/** Zona asociada a una entidad (distrito o barrio donde queda). Es aproximada: suma poco y nunca decide por sí sola. */
export interface UbicacionEntidad {
  zona: string;
  codigoEntidad: string;
  /**
   * La zona también es el nombre del establecimiento del QR (p. ej. Chosica): si el establecimiento ya se conoce no se suma, porque el
   * texto probablemente solo nombra el lugar donde se escribió.
   */
  ambiguaConEstablecimiento: boolean;
}

/** Datos que el filtro no puede sacar del texto. Todo es opcional: sin contexto el filtro solo lee el texto. */
export interface ContextoEvaluacion {
  /** Catálogo contra el que se compara el texto. Sin este campo se usa el catálogo oficial generado; `[]` desactiva la detección. */
  entidades?: readonly EntidadCatalogo[];
  /** El establecimiento ya se conoce (por el QR): cuenta como "entidad donde ocurrió" para los faltantes. */
  establecimientoConocido?: boolean;
  /** La persona ya subió archivos: cuenta como pruebas para los faltantes. */
  tieneArchivos?: boolean;
}

/** Lo que se guarda por señal (`chatbot.incidencia_analisis.senales`): frase encontrada (normalizada), tipo y puntos. */
export interface SenalDetectada {
  frase: string;
  tipo: TipoSenal;
  peso: number;
}

export interface ActorDetectado {
  cargo: string;
  nivel: NivelCargo;
}

export interface EntidadDetectada {
  codigo: string;
  nombre: string;
  /** `null` solo si el catálogo recibido no trae el tipo. */
  tipo: TipoEntidad | null;
}

export interface UbicacionDetectada {
  zona: string;
  /** Entidad a la que la tabla asocia la zona (aproximado). No es la entidad detectada: la ubicación no identifica por sí sola. */
  codigoEntidad: string;
}

/**
 * Identidad del texto (decisión del 2026-10-08, segunda ronda): lo que más pesa son los nombres, la ubicación y las entidades. Suma
 * entidad (nombre, sigla o alias) + titular o jefatura + nombre del titular + ubicación, con tope `TOPE_PUNTOS_IDENTIDAD`.
 */
export interface IdentidadDetectada {
  /** Puntos de identidad (con tope). Con `PUNTOS_IDENTIDAD_PARA_OTRANS` o más y algún indicio de corrupción, el caso va a OTRANS con certeza baja. */
  puntos: number;
  /** La entidad que identifica el texto: por nombre, sigla o alias, o por el nombre de su titular aunque no se nombre. */
  entidad: EntidadDetectada | null;
  /** Cómo se llegó a la entidad; `null` si no hay. */
  viaEntidad: ViaEntidad | null;
  /** Titular nombrado (por su cargo máximo o por su nombre en el catálogo). */
  titular: TitularDetectado | null;
  /** El texto nombra al titular registrado en el catálogo (al menos dos palabras del nombre, una de ellas un apellido). */
  nombreCoincide: boolean;
  /** Solo se llena si no hay entidad: con entidad detectada la ubicación ya no suma. */
  ubicacion: UbicacionDetectada | null;
}

/** Cargo máximo mencionado (con sus equivalentes). `nombreCoincide` es informativo: nunca suma ni decide la categoría. */
export interface TitularDetectado {
  cargo: string;
  /** `true` si el título no es "director general" ni "jefe institucional" (director ejecutivo, superintendente, ministro...). */
  esEquivalenteDelMaximo: boolean;
  /** El texto nombra al titular que el catálogo registra para la entidad detectada (hay homónimos y los cargos rotan). */
  nombreCoincide: boolean;
}

/** Referencia al catálogo para derivar (la ficha completa es otra fase): la entidad y qué contactos tiene el directorio. */
export interface ReferenciaDerivacion {
  codigoEntidad: string;
  contactosDisponibles: TipoContacto[];
  /** `null` si la fuente no trae destino para la entidad. */
  destinoSiTitular: DestinoSiTitular | null;
  /**
   * `true` si el texto menciona a la entidad y al cargo máximo (titular detectado): el destino es el de la denuncia contra el
   * titular. `false` si solo se mencionó la entidad: el destino se informa pero no aplica a un titular. `false` también sin destino.
   */
  aplicaAlTitular: boolean;
}

/** Resultado del filtro. Es una propuesta: la persona que revisa siempre confirma o corrige, y el destino no sale de aquí. */
export interface ResultadoCorrupcion {
  /** `false` si el texto tiene menos de 20 caracteres: no hay contenido que clasificar. */
  aplica: boolean;
  /** Suma de los pesos de `senales`. */
  puntaje: number;
  certeza: CertezaCorrupcion;
  propuestaCorrupcion: boolean;
  /** De dónde sale la propuesta: las reglas del léxico, o la identidad con un indicio y puntaje bajo (certeza baja). `null` sin propuesta. */
  origenPropuesta: OrigenPropuesta | null;
  senales: SenalDetectada[];
  actor: ActorDetectado | null;
  /** Nombre propio que escribió la persona. Solo informativo: nunca suma ni decide, y es una acusación sin comprobar. */
  nombreMencionado: string | null;
  entidad: EntidadDetectada | null;
  /** Identidad del texto (nombre, ubicación y entidad). Aditivo: no reemplaza `entidad` ni `titular`. */
  identidad: IdentidadDetectada;
  /** Solo si el cargo detectado es el máximo de una entidad (o su equivalente). */
  titular: TitularDetectado | null;
  /** Requisitos de la sección 3c que el texto aún no cumple (solo se calculan si se propone corrupción). */
  faltantes: FaltanteCorrupcion[];
  /** Corrupción siempre pasa por la OTRANS (la base lo hace cumplir): `true` solo si se propone corrupción. */
  requiereOtrans: boolean;
  /** Solo si se propone corrupción y la entidad está en el catálogo; si no, `null` (no se busca ni se inventa). */
  referenciaDerivacion: ReferenciaDerivacion | null;
  /**
   * Zona gris: el texto nombra una entidad del catálogo y a su titular (o un cargo de jefatura) junto a un verbo de cobro, pero
   * ninguna frase del léxico lo confirma. No propone corrupción por sí mismo: pide la segunda opinión de la IA, o de OTRANS si no hay IA.
   */
  requiereSegundaOpinion: boolean;
  /** Señal que no es corrupción pero es sensible (hoy solo acoso, hostigamiento o tocamientos). No suma al puntaje. */
  senalSensible: SenalSensible | null;
  /** Categoría que se sugiere cuando hay una señal sensible (acoso: `RECLAMO`; decide una persona). */
  categoriaSugerida: CategoriaIncidencia | null;
  /** Acoso contra un cargo mayor (director, jefe, administrador, titular o equivalente): conviene que OTRANS lo evalúe o reasigne. */
  escalarAOtrans: boolean;
  versionReglas: string;
}

/** Qué salió de sumar el peso del modelo al puntaje de las reglas (`combinarReglasConIa`). La persona que revisa siempre confirma o corrige. */
export interface ResultadoCombinacion {
  /** Propuesta final: las reglas ya la proponían, o el total supera el umbral. Nunca baja una propuesta de las reglas. */
  propuestaCorrupcion: boolean;
  puntajeReglas: number;
  /** Peso del modelo ya recortado a un entero de 0 a `PESO_MAXIMO_IA`; `null` si el modelo no estuvo disponible. */
  pesoIa: number | null;
  /** Puntaje de las reglas más el peso del modelo (0 si no hubo modelo). */
  puntajeTotal: number;
  umbral: number;
  /** `true` si el modelo llevó a corrupción un caso que las reglas solas no proponían. */
  subidaPorIa: boolean;
  acuerdo: AcuerdoReglasIa;
  /** Porcentaje con dos decimales, derivado del acuerdo y nunca mayor que `TOPE_CONFIANZA` (95). */
  confianza: number;
  /** Corrupción propuesta: va a OTRANS. */
  requiereOtrans: boolean;
  /** OTRANS debe mirarlo: corrupción propuesta, o duda de las reglas (zona gris) sin modelo que la resuelva (ante la duda, OTRANS). */
  revisionOtrans: boolean;
  /** Una persona debe confirmar: corrupción propuesta, discrepancia o duda. */
  requiereRevisionHumana: boolean;
}
