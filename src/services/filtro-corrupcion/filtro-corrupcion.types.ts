import type {
  CertezaCorrupcion,
  FaltanteCorrupcion,
  HuecoCatalogo,
  NivelCargo,
  TipoContacto,
  TipoEntidad,
  TipoSenal,
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
  /** `codigo` de la entidad del catálogo a la que apunta (ST PAD MINSA apunta a `minsa`); `null` si el destino no es una entidad del catálogo. */
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
  titular?: TitularCatalogo | null;
  /** `null` o ausente: la fuente no trae destino para esta entidad (no se inventa). */
  destinoSiTitular?: DestinoSiTitular | null;
  contactos?: ContactosEntidad | null;
  huecos?: readonly HuecoCatalogo[];
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
  senales: SenalDetectada[];
  actor: ActorDetectado | null;
  /** Nombre propio que escribió la persona. Solo informativo: nunca suma ni decide, y es una acusación sin comprobar. */
  nombreMencionado: string | null;
  entidad: EntidadDetectada | null;
  /** Solo si el cargo detectado es el máximo de una entidad (o su equivalente). */
  titular: TitularDetectado | null;
  /** Requisitos de la sección 3c que el texto aún no cumple (solo se calculan si se propone corrupción). */
  faltantes: FaltanteCorrupcion[];
  /** Corrupción siempre pasa por la OTRANS (la base lo hace cumplir): `true` solo si se propone corrupción. */
  requiereOtrans: boolean;
  /** Solo si se propone corrupción y la entidad está en el catálogo; si no, `null` (no se busca ni se inventa). */
  referenciaDerivacion: ReferenciaDerivacion | null;
  versionReglas: string;
}
