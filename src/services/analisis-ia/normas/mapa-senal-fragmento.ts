import { TemaNorma } from "@/enums/normas.enum.js";

/**
 * Mapa señal → supuesto del Anexo C de la Directiva N° 002-2023-PCM-SIP (RAG fase 1, trazabilidad). Lo aplica el código sobre las
 * frases de las señales que ya encontraron las reglas; el modelo no escribe citas. Es una referencia orientativa que OTRANS puede
 * corregir: cambiar una plantilla o un supuesto es cambiar datos, no lógica.
 *
 * Las plantillas usan el formato del léxico (`{a|b}` variantes, `~` hueco de hasta 3 palabras, `@clase` clase de palabras; ver
 * `lexico.ts` y `clases-lexico.ts`) y se buscan dentro de la frase normalizada de cada señal.
 *
 * El orden de los temas es el orden de prioridad al citar (el tope es `MAXIMO_SUPUESTOS_CITADOS`). Los ids son los de
 * `ia-poc/datos/fragmentos-normas.json`.
 *
 * Nunca se cita III-a (cohecho activo): lo comete quien paga y el ciudadano que denuncia podría ser ese. Tampoco hay regla para
 * II-b ni III-g (negociación incompatible): no hay señal del léxico que los distinga con honestidad; si no hay coincidencia se dice.
 */
export interface TemaDeNorma {
  tema: TemaNorma;
  /** Qué detecta, en palabras de quien revisa. Va en el motivo de la cita. */
  descripcion: string;
  plantillas: readonly string[];
  /** Supuestos del Anexo C relacionados, del más al menos cercano. */
  fragmentos: readonly string[];
}

export const MAPA_SENAL_FRAGMENTO: readonly TemaDeNorma[] = [
  {
    tema: TemaNorma.SOBORNO_O_COBRO,
    descripcion: "cobro, pedido o recepción de plata o de un beneficio",
    plantillas: [
      "{coima|coimas|coimear|coimean|coimeo|coimeando|coimero|coimeros}",
      "{soborno|sobornos|sobornar|sobornaron|sobornando|cohecho}",
      "{mordida|mordidas|moche|moches|diezmo|diezmos}",
      "{bajo|debajo de} la mesa",
      "bajo cuerda",
      "por debajo",
      "@verbo_cobro",
      "{cobro|cobran|cobraron} sin {recibo|boleta|comprobante}",
      "{pagar|paga|pagan|pagaron|pague} para que",
      "pagar para {saltar|saltarse} la cola",
      "{arreglar|arreglan|arreglo|arreglos} con {plata|dinero}",
      "a cambio de",
      "{propina|propinas|propinita}",
      "{recibe|recibio|recibiendo|reciben|recibian|recibieron} ~ {plata|dinero|monto|billete|billetes|sobre|porcentaje|comision|comisiones|propina|propinas|presente|regalito}",
      "{venden|vende|vendian|vendieron|vendio|vender|vendiendo} ~ @bien_vendible",
    ],
    fragmentos: ["ANEXO_C-III-b"],
  },
  {
    tema: TemaNorma.EXIGENCIA,
    descripcion: "exigir, condicionar u obligar a dar algo",
    plantillas: [
      "{exige|exigen|exigio|exigieron|exigia|exigian|exigiendo|exigir}",
      "{condiciona|condicionan|condiciono|condicionaron|condicionar}",
      "{obliga|obligan|obligo|obligaron|obligar}",
      "{hace|hacen|hizo|hicieron} pagar",
    ],
    fragmentos: ["ANEXO_C-III-d"],
  },
  {
    tema: TemaNorma.CONTRATACIONES,
    descripcion: "licitaciones, compras o contratos dirigidos o sobrevalorados",
    plantillas: [
      "licitacion dirigida",
      "{favorecieron|favorecio} a {una|su} empresa",
      "{compras|compra} {sobrevaloradas|sobrevalorada}",
      "{sobrevaloraron|sobrevaloro|sobrevaloracion}",
      "modificaron el contrato sin razon",
    ],
    fragmentos: ["ANEXO_C-II-d", "ANEXO_C-III-c"],
  },
  {
    tema: TemaNorma.APROPIACION_DE_DINERO,
    descripcion: "quedarse con dinero o fondos",
    plantillas: [
      "se {quedan|quedo|quedaron|queda|quedarse|quedara} con ~ {parte|una parte|porcentaje|plata|dinero|fondos|vueltos|vuelto|diferencia|aportes|cuotas|donaciones|comision|ganancia|ganancias}",
      "se {embolsan|embolsa|embolso|embolsaron|embolsarse}",
      "al bolsillo",
    ],
    fragmentos: ["ANEXO_C-III-h", "ANEXO_C-III-f"],
  },
  {
    tema: TemaNorma.APROPIACION,
    descripcion: "apropiarse, vender o sacar bienes del Estado",
    plantillas: [
      "se {roban|robaron|robando|llevan|llevo|llevaron|llevaba|llevaban|llevarse|apropian|apropia|apropiaron|apropio|desvian|desviaron|desvia|desviar}",
      "se {quedan|quedo|quedaron|queda} con ~ @bien_publico_fuerte",
      "{venden|vende|vendian|vendieron|vendio|vender|vendiendo} ~ @bien_publico_fuerte",
      "{sacan|saco|sacaron|sacar|saca|sacando} ~ {del|de la} {almacen|farmacia|deposito|bodega}",
    ],
    fragmentos: ["ANEXO_C-III-h", "ANEXO_C-I-b"],
  },
  {
    tema: TemaNorma.USO_PERSONAL_DE_BIENES,
    descripcion: "uso de bienes del Estado para fines personales",
    plantillas: [
      "uso personal",
      "{combustible|gasolina|petroleo|vales|viaticos} {de mas|repetidos|duplicados|inflados}",
      "{usan|usa|usaron} {la|el} {ambulancia|carro|camioneta|vehiculo}",
    ],
    fragmentos: ["ANEXO_C-II-c", "ANEXO_C-I-b"],
  },
  {
    tema: TemaNorma.NEPOTISMO,
    descripcion: "contratar o colocar a un pariente",
    plantillas: [
      "@verbo_colocar ~ {su|sus} @pariente",
      "@verbo_colocar ~ a {la|el|los|las} @pariente_directo",
      "{lo|la} pusieron por ser {pariente|familiar}",
      "es familiar de",
    ],
    fragmentos: ["ANEXO_C-I-d", "ANEXO_C-I-a"],
  },
  {
    tema: TemaNorma.CONFLICTO_DE_INTERESES,
    descripcion: "negocio o empresa de un pariente del servidor",
    plantillas: [
      "@negocio ~ de {su|sus} @pariente",
      "{dueno|duena|propietario|propietaria} de ~ {farmacia|empresa}",
    ],
    fragmentos: ["ANEXO_C-I-a"],
  },
  {
    tema: TemaNorma.FAVORECIMIENTO,
    descripcion: "favorecer a conocidos, amigos o a su partido",
    plantillas: [
      "{prioriza|priorizan|priorizo|priorizaron|favorece|favorecen|favorecio|favorecieron|beneficia|benefician|beneficio|beneficiaron|acomoda|acomodan|acomodo|acomodaron|atiende|atienden|atendio|atendieron|pasan|pasar|pasaron|pasaba|afilia|afilian|cuelan|colan|colaron|colar|colarlos} ~ @conocidos",
      "favoritismo",
      "trato preferencial",
      "amigo del director",
      "{favorece|favorecen|favorecio} a su {partido|gente|institucion}",
    ],
    fragmentos: ["ANEXO_C-I-c"],
  },
  {
    tema: TemaNorma.PENALIDADES,
    descripcion: "no cobrar o perdonar penalidades o multas",
    plantillas: [
      "{penalidades|penalidad}",
      "{perdonaron|perdonan|perdono} {las|la} {multas|multa}",
    ],
    fragmentos: ["ANEXO_C-II-e"],
  },
  {
    tema: TemaNorma.INFORMACION_PRIVILEGIADA,
    descripcion: "dar o filtrar información reservada o privilegiada",
    plantillas: ["informacion {reservada|privilegiada}"],
    fragmentos: ["ANEXO_C-II-f"],
  },
  {
    tema: TemaNorma.ENRIQUECIMIENTO,
    descripcion: "patrimonio que no se explica por sus ingresos",
    plantillas: [
      "se hizo {rico|rica} sin que",
      "{tiene|tienen} propiedades que no justifica",
      "{se enriquecio|se enriquecieron}",
      "{camioneta|casa} que no corresponde a su sueldo",
    ],
    fragmentos: ["ANEXO_C-III-e"],
  },
  {
    tema: TemaNorma.TRAFICO_DE_INFLUENCIAS,
    descripcion: "ofrecer arreglar un asunto invocando influencias",
    plantillas: ["{podia|puede|puedo} arreglar", "influencias"],
    fragmentos: ["ANEXO_C-III-i"],
  },
  {
    tema: TemaNorma.VENTAJA_INDEBIDA,
    descripcion: "abuso de poder o aprovechamiento del cargo",
    plantillas: ["abuso de poder", "aprovechamiento"],
    fragmentos: ["ANEXO_C-I-e", "ANEXO_C-II-f"],
  },
];
