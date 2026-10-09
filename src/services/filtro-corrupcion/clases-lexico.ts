import { normalizarTexto } from "@/services/filtro-corrupcion/normalizar-texto.js";

/*
 * Clases de palabras del léxico. En una plantilla, `@nombre` calza con cualquier palabra de la clase (una sola palabra, sin
 * huecos): así "verbo de cobro × objeto × complemento" se escribe una vez y no como miles de frases. Las palabras se escriben en
 * minúsculas y sin tildes; las faltas de ortografía frecuentes ("cunado") van como variante aparte.
 */
// prettier-ignore
const CLASES_CRUDAS = {
  /** Pedir, cobrar, exigir o condicionar algo a cambio de un servicio (las formas "cobro" y "solicito" se tratan aparte: pueden ser sustantivo). */
  verbo_cobro: [
    "pide", "piden", "pidio", "pidieron", "pedia", "pedian", "pidiendo", "pedir", "pedirme", "pedirle", "pedirles", "pidiera", "pedira", "pediran",
    "cobra", "cobran", "cobraron", "cobraba", "cobraban", "cobrar", "cobrarme", "cobrarle", "cobrarles", "cobrando", "cobrara", "cobraran",
    "exige", "exigen", "exigio", "exigieron", "exigia", "exigian", "exigiendo", "exigir", "exigirme", "exigirle",
    "solicita", "solicitan", "solicitaron", "solicitaba", "solicitar", "solicitando",
    "condiciona", "condicionan", "condiciono", "condicionaron", "condicionar", "condicionaba",
    "saca", "saco", "sacan", "sacaron", "sacaba", "sacaban", "sacarme",
    "insinua", "insinuo", "insinuan", "insinuaron",
  ],
  /** Solo cobrar (sin "pedir" ni "exigir", que también se usan para papeles): "cobra por las camas" ya es sospechoso sin objeto de dinero. */
  verbo_cobrar: ["cobra", "cobran", "cobraron", "cobraba", "cobraban", "cobrar", "cobrarme", "cobrarle", "cobrando"],
  /** Qué se pide a cambio: acciones y cosas del servicio ("para atender", "por firmar", "para que me den la cita", "para no..."). */
  complemento: [
    "atender", "atenderme", "atenderlo", "atenderla", "atenderle", "atencion",
    "firmar", "firmarme", "firma", "firmas", "aprobar", "aprobarme", "aprobarlo", "aprobacion",
    "dar", "darme", "darle", "darnos", "dame", "entregar", "entregarme", "entregarle",
    "operar", "operarme", "operarlo", "operacion", "cirugia",
    "acelerar", "acelerarme", "adelantar", "adelantarme", "adelantarlo", "agilizar", "soltar", "soltarme", "destrabar", "liberar",
    "separar", "separarme", "reservar", "asignar", "asignarme",
    "pasar", "pasarme", "pase", "pases", "pasen", "pasara", "colar", "colarme", "colarlo", "meter", "meterme", "meterlo", "saltar", "saltarme",
    "tramitar", "tramitarme", "tramite", "tramites", "expediente", "expedientes",
    "informe", "informes", "certificado", "certificados", "cita", "citas", "cama", "camas", "turno", "turnos", "cupo", "cupos",
    "resultado", "resultados", "receta", "recetas", "cobertura", "referencia", "referencias", "derivacion", "transferencia", "pago", "pagos",
    "conseguir", "obtener", "otorgar", "otorgarme", "autorizar", "autorizarme", "autorizacion", "dejar", "dejarme", "dejarlos",
    "ingresar", "hospitalizar", "internar", "revisar", "revisarme", "evitar", "poder", "que", "no",
  ],
  /** Qué se puede cobrar o vender aunque no se mencione dinero: servicios y documentos que deberían ser gratuitos o no tener precio. */
  bien_vendible: [
    "cita", "citas", "cama", "camas", "turno", "turnos", "cupo", "cupos", "certificado", "certificados", "informe", "informes",
    "descanso", "descansos", "constancia", "constancias", "licencia", "licencias", "receta", "recetas", "resultado", "resultados",
    "expediente", "expedientes", "pase", "pases", "referencia", "referencias", "firma", "firmas", "sello", "sellos", "vacuna", "vacunas",
    "atencion", "atenciones", "medicina", "medicinas", "medicamento", "medicamentos", "remedio", "remedios", "plaza", "plazas",
    "puesto", "puestos", "cobertura", "afiliacion", "afiliaciones",
  ],
  /** Personas y empresas a las que se cobra o de las que se recibe: proveedores, pacientes, empresas... */
  tercero: [
    "proveedores", "proveedor", "empresas", "empresa", "postores", "postor", "contratistas", "contratista", "constructoras", "constructora",
    "laboratorios", "clinicas", "pacientes", "usuarios", "afiliados", "comerciantes", "vendedores", "ambulantes", "terceros", "ipress",
    "concesionarios", "farmacias", "familiares",
  ],
  /** Bienes del Estado que no deberían salir del hospital: apropiárselos es peculado. */
  bien_publico_fuerte: [
    "medicinas", "medicina", "medicamentos", "medicamento", "remedios", "insumos", "vacunas", "combustible", "gasolina", "petroleo",
    "donaciones", "donacion", "vales", "viaticos", "fondos", "presupuesto", "alimentos", "viveres", "canastas", "jeringas", "gasas",
    "guantes", "reactivos", "panales", "suplementos",
  ],
  /** Bienes que a veces se mueven con razón (a reparar, a otro servicio): solo suman un poco. */
  bien_publico_ambiguo: [
    "equipos", "equipo", "ambulancia", "ambulancias", "camillas", "computadoras", "laptops", "comida", "materiales", "cajas", "baterias",
    "muebles", "televisores",
  ],
  /** Parientes y allegados (nepotismo, conflicto de intereses). */
  pariente: [
    "hermano", "hermana", "hermanos", "hermanas", "cunado", "cunada", "cunados", "cuniado", "cuniada", "concunado", "concunada", "concuno", "primo", "prima",
    "primos", "primas", "sobrino", "sobrina", "sobrinos", "sobrinas", "esposa", "esposo", "mujer", "marido", "suegro", "suegra", "yerno",
    "nuera", "hija", "hijo", "hijos", "hijas", "padre", "madre", "papa", "mama", "tio", "tia", "abuelo", "abuela", "compadre", "comadre",
    "ahijado", "ahijada", "familiar", "familiares", "familia", "pareja", "conviviente", "enamorado", "enamorada", "novia", "novio",
    "amigo", "amiga", "amigos", "amigas", "paisano", "paisanos", "allegado", "allegados",
  ],
  /** Parentesco cercano para frases en que el cargo no se marca con "su" ("pusieron a la hija"): sin padres, pareja ni amigos, que sobran en quejas normales. */
  pariente_directo: [
    "hermano", "hermana", "hermanos", "hermanas", "cunado", "cunada", "concunado", "concunada", "concuno", "primo", "prima", "primos", "primas", "sobrino",
    "sobrina", "sobrinos", "sobrinas", "esposa", "esposo", "suegro", "suegra", "yerno", "nuera", "hija", "hijo", "compadre", "comadre",
    "ahijado", "ahijada", "familiar", "familiares",
  ],
  /** Gente cercana a quien se favorece (sin ser pariente: eso va en `pariente`). */
  conocidos: [
    "conocidos", "conocidas", "allegados", "allegadas", "paisanos", "paisanas", "recomendados", "recomendadas", "suyos", "amigos",
    "amistades", "socios", "compadres",
  ],
  /** Negocios que pueden ser de un pariente del funcionario. */
  negocio: [
    "empresa", "empresas", "laboratorio", "laboratorios", "clinica", "clinicas", "restaurante", "restaurantes", "constructora",
    "constructoras", "farmacia", "farmacias", "botica", "boticas", "consultora", "firma", "negocio", "negocios", "proveedora",
    "ferreteria", "imprenta", "tienda", "taller", "transportes", "distribuidora",
  ],
  /** Verbos de colocar a alguien en un puesto (nepotismo). */
  verbo_colocar: [
    "contrato", "contrataron", "contratan", "contrata", "contraten", "contratar", "contratarlos", "metio", "metieron", "mete", "meten", "meter",
    "puso", "pusieron", "pone", "ponen", "poner", "coloco", "colocaron", "coloca", "colocan", "nombro", "nombraron", "nombra", "nombran",
    "acomodo", "acomodaron", "acomoda", "acomodan", "incorporo", "incorporaron", "empleo", "emplearon", "promovio", "ascendio", "ascendieron",
  ],
  /** Hacer más rápido o saltarse una cola a cambio de algo. */
  accion_favor: [
    "acelerar", "aceleraba", "acelera", "aceleran", "adelantar", "adelantaba", "adelanta", "adelantan", "agilizar", "agilizaba", "agiliza",
    "agilizan", "destrabar", "destrababa", "destraba", "soltar", "soltaba", "suelta", "sueltan", "arreglar", "arreglaba", "arregla",
    "arreglan", "colar", "colaba", "cuela", "cuelan", "liberar", "libera", "separar", "separaba", "reservar", "saltar", "saltaba", "salta",
  ],
  /** Lo que se hace pasar o colar: la cola, la lista o el turno. */
  cola_o_lista: ["cola", "lista", "fila", "turno", "turnos", "cupo", "expediente", "atencion"],
} as const;

export type NombreDeClase = keyof typeof CLASES_CRUDAS;

export const CLASES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(CLASES_CRUDAS).map(([nombre, palabras]) => [nombre, new Set(palabras.map(normalizarTexto))]),
);

/** Clases a las que pertenece cada palabra: sirve para buscar sin recorrer todas las clases en cada posición del texto. */
export const CLASES_POR_PALABRA: ReadonlyMap<string, readonly string[]> = (() => {
  const porPalabra = new Map<string, string[]>();
  for (const [nombre, palabras] of CLASES)
    for (const palabra of palabras) porPalabra.set(palabra, [...(porPalabra.get(palabra) ?? []), nombre]);
  return porPalabra;
})();

export const PREFIJO_DE_CLASE = "@";
