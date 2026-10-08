import type { CertezaCorrupcion, FaltanteCorrupcion, NivelCargo, TipoSenal } from "@/enums/filtro-corrupcion.enum.js";

/** Una entidad del catálogo (plan de cierre, paso 2). El nombre y los alias se buscan como secuencias de palabras. */
export interface EntidadCatalogo {
  codigo: string;
  nombre: string;
  alias?: readonly string[];
}

/** Datos que el filtro no puede sacar del texto. Todo es opcional: sin contexto el filtro solo lee el texto. */
export interface ContextoEvaluacion {
  /** Catálogo de entidades contra el que se compara el texto. Sin él no se detecta entidad. */
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
  /** Requisitos de la sección 3c que el texto aún no cumple (solo se calculan si se propone corrupción). */
  faltantes: FaltanteCorrupcion[];
  versionReglas: string;
}
