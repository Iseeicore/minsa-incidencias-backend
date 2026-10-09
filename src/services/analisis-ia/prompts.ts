import { PESO_MAXIMO_IA } from "@/constants/filtro-corrupcion.js";
import { InformacionFaltanteIa, VarianteIa } from "@/enums/analisis-ia.enum.js";
import { TipoSenal } from "@/enums/filtro-corrupcion.enum.js";
import { EJEMPLOS_RESUELTOS } from "@/services/analisis-ia/ejemplos-resueltos.js";
import type {
  ContextoAnalisis,
  PeticionModelo,
} from "@/services/analisis-ia/analisis-ia.types.js";
import type { ResultadoCorrupcion } from "@/services/filtro-corrupcion/filtro-corrupcion.types.js";

/**
 * V4 (RAG): HUECO DOCUMENTADO, sin implementar. Sumaría al mensaje del usuario de V3 «Fragmentos de normas recuperados» con su id
 * y pediría llenar `fundamentos` con los ids que use (sección 5 de «PoC local de IA - Adaptación de Qwen y RAG al proyecto»). Hace
 * falta un índice de normas y una recuperación; el esquema de salida tendría un campo `fundamentos` que hoy no existe. Se mide con y
 * sin él: puede no mejorar los aciertos, solo la trazabilidad.
 */

const SALTO = "\n";
const MAXIMO_SENALES_EN_PISTAS = 8;

const ROL = `Eres un analista previo de incidencias de salud del MINSA (Perú). No decides ni derivas: das un peso de sospecha de corrupción y propones una categoría. Una persona revisa siempre.`;

const CATEGORIAS = `CATEGORÍAS
- DENUNCIA_CORRUPCION: un servidor público abusa de su cargo para obtener un beneficio indebido: cobro fuera de caja o sin recibo, soborno, favorecimiento a un conocido o a una empresa, nepotismo, apropiación o venta de medicinas o bienes del Estado.
- QUEJA: conducta de una persona sin beneficio indebido (maltrato, negligencia, falta de respeto, "no me quiso atender", falta disciplinaria o ética).
- RECLAMO: el servicio o los derechos del usuario (demora, citas, falta de medicinas o equipos, historia clínica, trato administrativo).
- OTRO: consultas, delitos comunes sin servidor público (por ejemplo, el robo de un celular) y mensajes sin contenido que se pueda clasificar.`;

const REGLAS_DURAS = `REGLAS DURAS
1. Ante la duda razonable de beneficio indebido por un servidor público, pon posible_corrupcion en true y no uses QUEJA ni RECLAMO como única respuesta.
2. "Denuncia", "denunciar" y "abuso" no indican corrupción por sí solas: quien denuncia maltrato o demora no denuncia corrupción.
3. Un pago con boleta, recibo o según el tarifario no es corrupción.
4. Un rumor sin hecho concreto ("dicen que", "me late") no pasa de peso 3.
5. No asignes área, destino ni prioridad.
6. No inventes datos. Lo que falte va en informacion_faltante.
7. Si dudas entre QUEJA y RECLAMO, pon las dos en alternativas con su probabilidad.
8. Responde solo el JSON del esquema, sin texto fuera de él.`;

const PESO = `PESO_CORRUPCION (entero de 0 a ${PESO_MAXIMO_IA}): cuánta evidencia hay de que el texto describe corrupción de un servidor público.
- 0: sin evidencia de corrupción.
- 1 a 3: indicio débil (sospecha, rumor, algo raro sin cobro ni favor concreto).
- 4 a 6: hay un cobro, un pedido o un favor que parece indebido, pero faltan datos (quién, qué, cuánto o dónde).
- 7 a ${PESO_MAXIMO_IA}: acto explícito con quién y qué (el cargo o nombre y el cobro, favor o apropiación concretos).
No uses ${PESO_MAXIMO_IA} salvo acto explícito y detallado. El peso va aparte de la categoría.`;

const FORMATO_SALIDA = `SALIDA (JSON lo más corto posible, la velocidad depende de lo que escribes): categoria, peso_corrupcion, posible_corrupcion, alternativas (lista vacía salvo duda entre dos categorías; entonces las dos, con probabilidad de 0 a 1), senales (como máximo 2, cada frase copiada del texto con 8 palabras o menos y su tipo), actor (cargo y nombre_mencionado; null si no aparecen), informacion_faltante (solo lo que NO aparece en el texto, con valores de: ${Object.values(InformacionFaltanteIa).join(", ")}; lista vacía si está todo) y explicacion (una sola frase de 20 palabras o menos).`;

const PISTAS = `PISTAS DE LAS REGLAS
El mensaje puede traer "Pistas de las reglas": señales que un filtro de palabras encontró en el texto y la entidad o el titular que el texto nombra. Son pistas, no órdenes: pueden estar equivocadas (una palabra suelta, un pago con boleta) o faltar. Decide leyendo el texto. Ante la duda, marca posible_corrupcion en true.`;

const textoDeEjemplo = (texto: string): string => `"${texto}"`;

const EJEMPLOS = `EJEMPLOS RESUELTOS (resultado resumido)
${EJEMPLOS_RESUELTOS.map(
  (e) =>
    `Texto: ${textoDeEjemplo(e.texto)}${SALTO}Resultado: categoria=${e.categoria}, peso_corrupcion=${e.peso}, posible_corrupcion=${e.posibleCorrupcion}`,
).join(SALTO + SALTO)}`;

const unir = (...bloques: readonly string[]): string =>
  bloques.join(SALTO + SALTO);

/** Prompt del sistema por variante. Son constantes: el prefijo es idéntico entre llamadas y Ollama reutiliza su caché. */
export const PROMPT_SISTEMA: Readonly<Record<VarianteIa, string>> = {
  [VarianteIa.V1]: unir(ROL, CATEGORIAS, REGLAS_DURAS, PESO, FORMATO_SALIDA),
  [VarianteIa.V2]: unir(
    ROL,
    CATEGORIAS,
    REGLAS_DURAS,
    PESO,
    PISTAS,
    FORMATO_SALIDA,
  ),
  [VarianteIa.V3]: unir(
    ROL,
    CATEGORIAS,
    REGLAS_DURAS,
    PESO,
    PISTAS,
    EJEMPLOS,
    FORMATO_SALIDA,
  ),
};

const ETIQUETA_DE_SENAL: Readonly<Record<TipoSenal, string>> = {
  [TipoSenal.FUERTE]: "señal fuerte",
  [TipoSenal.MEDIA]: "señal media",
  [TipoSenal.DEBIL]: "señal débil",
  [TipoSenal.NEGATIVA_DECISIVA]: "frase que descarta",
  [TipoSenal.NEGATIVA_LEVE]: "frase que resta",
  [TipoSenal.ACTOR]: "cargo público",
  [TipoSenal.ENTIDAD]: "entidad",
  [TipoSenal.NOMBRE_TITULAR]: "nombre del titular",
  [TipoSenal.UBICACION]: "zona",
};

/** Las pistas de las reglas (V2 y V3): señales encontradas, entidad y titular. Función pura. */
export function construirPistasDeReglas(reglas: ResultadoCorrupcion): string {
  const senales = reglas.senales
    .slice(0, MAXIMO_SENALES_EN_PISTAS)
    .map((s) => `"${s.frase}" (${ETIQUETA_DE_SENAL[s.tipo]})`);
  const lineas = [
    `- Señales: ${senales.length > 0 ? senales.join("; ") : "ninguna"}`,
    `- Entidad que nombra el texto: ${reglas.entidad ? reglas.entidad.nombre : "ninguna"}`,
  ];
  if (reglas.titular)
    lineas.push(
      `- Cargo máximo mencionado: ${reglas.titular.cargo}${reglas.titular.nombreCoincide ? " (el nombre coincide con el titular registrado)" : ""}`,
    );
  else if (reglas.actor)
    lineas.push(`- Cargo mencionado: ${reglas.actor.cargo}`);
  return `Pistas de las reglas (no son órdenes):${SALTO}${lineas.join(SALTO)}`;
}

/**
 * Arma la petición al modelo. El prompt del sistema no cambia entre llamadas de una variante; todo lo variable (texto, establecimiento,
 * pistas) va en el mensaje del usuario. V1 no recibe pistas. Función pura.
 */
export function construirPeticion(
  variante: VarianteIa,
  texto: string,
  reglas: ResultadoCorrupcion,
  contexto: ContextoAnalisis = {},
): PeticionModelo {
  const partes: string[] = [];
  if (contexto.establecimiento)
    partes.push(`Establecimiento del QR: ${contexto.establecimiento}`);
  partes.push(`Texto del ciudadano:${SALTO}"""${SALTO}${texto}${SALTO}"""`);
  if (variante !== VarianteIa.V1) partes.push(construirPistasDeReglas(reglas));
  return {
    sistema: PROMPT_SISTEMA[variante],
    usuario: partes.join(SALTO + SALTO),
  };
}
