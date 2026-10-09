/*
 * Patrones generalizables de cobro, soborno y apropiación (reglas-corrupcion-v1.2). En vez de memorizar frases, se combinan
 * piezas: verbo de cobro × objeto × complemento ("pide plata a los proveedores para firmar los pagos"). Las plantillas usan el
 * mismo formato que `lexico.ts` más las clases de `clases-lexico.ts` (`@verbo_cobro`, `@complemento`...).
 *
 * Todas son "negables": si una negación las precede ("no me pidió plata", "nadie me cobró") no cuentan. Todas pertenecen a la
 * familia de cobro: las que se pisan en el texto cuentan una vez (la de más puntos).
 */

/** Objetos que son dinero o su equivalente en jerga. "monto" es el importe ("50 soles") que el normalizador deja en el texto. */
const DINERO = [
  "plata",
  "platita",
  "dinero",
  "dinerito",
  "monto",
  "soles",
  "un sol",
  "cuota",
  "cuotas",
  "su cuota",
  "una cuota",
  "efectivo",
  "yape",
  "yapes",
  "billete",
  "billetes",
  "un billete",
  "lucas",
  "porcentaje",
  "un porcentaje",
  "comision",
  "comisiones",
  "una comision",
  "un pago extra",
  "pago extra",
  "pago adicional",
  "un pago adicional",
  "pago aparte",
  "un pago aparte",
  "un pago por fuera",
];

/** Dinero disfrazado: propinas, "detallitos", gaseosas, sobres... Ya son sospechosos aunque no digan "plata". */
const DISFRAZADO = [
  "propina",
  "propinas",
  "una propina",
  "propinita",
  "un sobre con",
  "detallito",
  "un detallito",
  "gaseosa",
  "una gaseosa",
  "gaseosita",
  "chela",
  "cafecito",
  "un cafecito",
  "regalito",
  "un regalito",
  "un presente",
  "colaboracion",
  "una colaboracion",
  "aporte",
  "un aporte",
];

/** Piden "algo" sin decir qué: solo cuenta si piden también un servicio a cambio. */
const SIN_NOMBRE = ["algo", "algito", "algo de plata", "algo a cambio", "apoyo", "un apoyo", "favor", "un favor", "un regalo"];

/** Lo que reparte quien cobra: con "por fuera", "aparte" o "de más" el importe deja de ser un cobro normal. */
const FUERA_DE_CAJA = ["por fuera", "por la izquierda", "por debajo", "bajo la mesa", "bajo cuerda", "aparte"];

const alternativas = (...listas: readonly (readonly string[])[]): string => `{${listas.flat().join("|")}}`;
const OBJETO_DE_COBRO = alternativas(DINERO, DISFRAZADO);
const OBJETO_DE_DINERO = alternativas(DINERO);
const OBJETO_SIN_NOMBRE = alternativas(SIN_NOMBRE);
const DINERO_O_DISFRAZADO_O_NADA = alternativas(DINERO, DISFRAZADO, SIN_NOMBRE);
const ARTICULO = "{el|la|los|las|un|una|mi|su|}";
const CON_ARTICULO = "{un|una|el|la|su|}";
const PARA_O_POR = "{por|para}";

/** Una plantilla por cada forma del verbo: "cobro" y "solicito" solo cuentan con pronombre ("me cobró"), porque también son sustantivo. */
const conVerbo = (resto: string): string[] => [`@verbo_cobro ${resto}`, `{me|nos|le|les|te} {cobro|solicito} ${resto}`];

/** Verbo de cobro + objeto + "por/para" + servicio: "pide plata a los proveedores para firmar los pagos". */
export const FRASES_FUERTES_DE_COBRO: readonly string[] = [
  ...conVerbo(`~ ${OBJETO_DE_COBRO} ~ ${PARA_O_POR} ${ARTICULO} @complemento`),
  // "cobró" (3.ª persona del pasado) se escribe igual que el sustantivo "cobro": solo cuenta cuando nombra también el servicio.
  `cobro ~ ${OBJETO_DE_COBRO} ~ ${PARA_O_POR} ${ARTICULO} @complemento`,
  ...conVerbo(`~ ${OBJETO_SIN_NOMBRE} ~ ${PARA_O_POR} ${ARTICULO} @complemento`),
  "@verbo_cobrar {por|para} {el|la|los|las|un|una|mi|su|} @bien_vendible",
  "me {sacaron|sacan|saco|sacaban|sacar|sacarme|quisieron sacar} ~ " + OBJETO_DE_DINERO,
  `{arreglar|arreglo|arreglan|arreglas|arreglamos|arreglaron|arreglarlo|arreglarte|arreglarse|arregla} ~ con ${CON_ARTICULO} ${DINERO_O_DISFRAZADO_O_NADA}`,
  "se {quedan|quedo|quedaron|queda|quedarse|quedara} con ~ {parte|una parte|porcentaje|plata|dinero|fondos|vueltos|vuelto|diferencia|aportes|cuotas|donaciones|comision|ganancia|ganancias}",
  "se {embolsan|embolsa|embolso|embolsaron|embolsarse}",
  "se {lo|los|la|las} {echo|echan|echaron|metio|metieron|guardo|guardaron|pasa|pasan} ~ al bolsillo",
  "{recibe|recibio|recibiendo|reciben|recibian|recibieron|recibia|recibir} ~ {un sobre con|un presente|un regalito|un porcentaje|porcentaje|comision|comisiones|propina|propinas|dadiva|dadivas|billetes|gaseosa}",
  "{recibe|recibio|recibiendo|reciben|recibian|recibieron|recibia|recibir} ~ {plata|dinero|monto|billete} de {los|las} @tercero",
  "se {roban|robaron|robando|llevan|llevo|llevaron|llevaba|llevaban|llevarse|apropian|apropia|apropiaron|desvian|desviaron|desvia|desviar|quedan|quedaron|quedo} ~ @bien_publico_fuerte",
  "{venden|vende|vendio|vendieron|vendia|vendian|vender|vendiendo|revenden|revende|revendio} ~ {el|la|los|las|mi|sus|su|} @bien_vendible",
  "me {vendio|vendieron|vende|venden} ~ @bien_vendible",
  "@verbo_colocar ~ a {su|sus|puro|puros|puras|toda su|todos sus} @pariente",
  "@verbo_colocar ~ a {la|el|los|las} @pariente_directo",
];

/** Cobro sin servicio nombrado, o sospechas que necesitan otra señal: conflicto de intereses, favoritismo, "por fuera". */
export const FRASES_MEDIAS_DE_COBRO: readonly string[] = [
  ...conVerbo(`~ ${OBJETO_DE_COBRO}`),
  ...conVerbo("~ {a|de} {los|las} @tercero ~ {monto|por fuera|aparte}"),
  "@verbo_cobrar {por|para} {el|la|los|las|un|una|} {atender|firmar|aprobar|dar|entregar|operar|acelerar|adelantar|tramitar|atencion|firma}",
  `si {no|} {le|les|me|} {dejaba|dejo|dejas|dejaban|dejara|daba|das|doy|diera|dieras|entregaba|entregas|entrego|alcanzaba|alcanzo|alcanzas|yapeaba|yapeas|yapeo|yapee|depositaba|depositas} ~ ${OBJETO_DE_COBRO}`,
  `{caerle|caerles|caer|caigo|cae|caes} con ${CON_ARTICULO} {detalle|detallito|billete|sobre|algo|plata|regalito|propina|gaseosa}`,
  `{ponerse|ponerme|ponerte|ponerle|poner|ponga|pongo|pones|ponte|ponen|pusieron} con ${CON_ARTICULO} ${DINERO_O_DISFRAZADO_O_NADA}`,
  `{hace|hacen|hizo|hicieron|obliga|obligan|obligo|obligaron|manda|mandan|mando|obligar|hacer} {pagar|poner|dejar|aportar|cotizar|yapear|depositar} ~ ${OBJETO_DE_COBRO}`,
  `${OBJETO_DE_COBRO} {${FUERA_DE_CAJA.join("|")}}`,
  "{para|por} {su|la|mi|una|el|un|} {gaseosa|gaseosita|chela|cafecito|propina|propinita}",
  "{le|les|se} {paga|pagan|pago|pagaron|pagas|pagamos|pagaba|pagaban|pagare} ~ para {que|no|poder|conseguir|obtener}",
  "{pagar|paga|pagan|pagaron|pagamos|pague|pagando|arreglan|arreglar|arreglaron|dar|dan|dieron|da|dejar|dejan|dejaron|recibe|reciben|recibio|cobran|cobra|cobrar|cobraron|mueve|mueven} ~ por debajo",
  "con {un|el|su} {billete|billetes|billetito}",
  "{prioriza|priorizan|priorizo|priorizaron|favorece|favorecen|favorecio|favorecieron|beneficia|benefician|beneficio|beneficiaron|acomoda|acomodan|acomodo|acomodaron|atiende|atienden|atendio|atendieron|pasan|pasar|pasaron|pasaba|afilia|afilian|cuelan|colan|colaron|colar|colarlos} ~ @conocidos",
  "@negocio ~ de {su|sus} @pariente",
  "{sin concurso|sin convocatoria|sin proceso de seleccion|a dedo}",
  "{deja|dejan|dejo|dejaron|dejar|entrega|entregan|da|dan|devuelve|devuelven|pasa|pasan|alcanza|alcanzan} ~ {el|un|su|} {porcentaje|comision|diezmo|moche|mordida|sobre|presente}",
  "{devuelve|devuelven|devolver|devolvio|devolvieron} ~ {el|un} favor",
  "a cambio de {un|el|algun|} {algo|plata|dinero|favor|favores|pago|monto|propina|regalo}",
  "{condiciona|condicionan|condiciono|condicionaron|condicionar} ~ {a|con} {el|un|} {pago|plata|dinero|porcentaje|monto|aporte|colaboracion}",
  "{por|con|a cambio de} {monto|plata|dinero|un sobre|un billete} ~ @accion_favor",
  "{combustible|gasolina|petroleo|vales|viaticos} {de mas|repetidos|duplicados|inflados}",
  "{combustible|gasolina|vales|viaticos|camioneta|camionetas|carro|carros|vehiculo|vehiculos|ambulancia} ~ {sus|los} @conocidos",
  "{sacan|saco|sacaron|sacar|saca|sacando} ~ {del|de la} {almacen|farmacia|deposito|bodega}",
  "se {roban|robaron|robando|llevan|llevo|llevaron|llevaba|llevaban|llevarse|apropian|apropia|apropiaron|desvian|desviaron|desvia|desviar|quedan|quedaron|quedo} ~ @bien_publico_ambiguo",
];

/** Dicho en corto o a medias: solo suma. */
export const FRASES_DEBILES_DE_COBRO: readonly string[] = [
  "{cuelan|colan|colaron|colo|colar|colarme|colarlo|colarse|cuela|colando} ~ @cola_o_lista",
  "{pasar|pasan|pasaron|pasa|pasarme|pasarlo|pasando} por encima de ~ {cola|lista|fila|turno|turnos|otros|pacientes|los demas}",
];

/** Jerga de soborno que por sí sola ya es señal fuerte (como "coima"): "mordida", "moche", "bajo la mesa". */
export const FRASES_FUERTES_SIN_VERBO: readonly string[] = [
  "{mordida|mordidas|moche|moches|diezmo|diezmos}",
  "{bajo|debajo de} la mesa",
  "bajo cuerda",
  "por debajo del agua",
];

/** Negaciones del cobro ("no me pidió plata", "nadie cobró", "sin cobro"): neutralizan una señal débil como "corrupción". */
export const NEGACIONES_DE_COBRO: readonly string[] = [
  "{no|nunca|nadie|ni|tampoco} {me|nos|le|les|} @verbo_cobro",
  "{no|nunca|nadie|ni|tampoco} {me|nos|le|les|} {cobro|solicito}",
  "{sin|cero} {cobro|cobros|pedido|pedidos}",
  "no {hubo|hay|habia|existio} {cobro|cobros|pedido|pedidos|pago|coima|coimas|plata}",
  "no es {tema|cuestion|asunto|cosa|problema} de {plata|dinero|cobro|cobros|pagos}",
  "nada de {plata|dinero|cobro|coima}",
];
