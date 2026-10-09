import { NivelCargo } from "@/enums/filtro-corrupcion.enum.js";
import { FRASES_FUERTES_SIN_VERBO, NEGACIONES_DE_COBRO } from "@/services/filtro-corrupcion/lexico-cobro.js";

/*
 * Léxico de corrupción v1 (vault: "Léxico de corrupción - Señales y frases negativas"). Es una propuesta por validar con
 * el área usuaria y con mensajes reales: cambiar una frase o un peso es cambiar datos, no lógica.
 *
 * Formato de las plantillas: se escriben en minúsculas y sin tildes. `{a|b}` son variantes (`{a|}` la hace opcional) y
 * `~` es un hueco de hasta 3 palabras cualesquiera. Los montos ("50 soles") se quitan del texto antes de buscar.
 * Los pesos no están aquí: salen del tipo (`PESO_POR_TIPO`).
 */

/** Sección 3: cobro, soborno y apropiación (+3). */
export const FRASES_FUERTES: readonly string[] = [
  "{coima|coimas|coimear|coimean|coimeo|coimeando|coimero|coimeros}",
  "{soborno|sobornos|sobornar|sobornaron|sobornando|cohecho}",
  "por debajo de la mesa",
  "{arreglar|arreglan|arreglo|arreglos} con {plata|dinero}",
  "me {pidio|pidieron|pide|piden} {dinero|plata} para",
  "me {cobraron|cobro|cobran} ~ para {darme|dar} la cita",
  "{cobran|cobraban} por {la|las} {cita|citas}",
  "{venden|vende|vendian} {las|la|los|el} {citas|cita|cupos|cupo|camas|cama}",
  "{venden|vende|vendian} {citas|cupos|camas}",
  "pagar para que me atiendan",
  "pagar para {saltar|saltarse} la cola",
  "me {ofrecio|ofrecieron} atenderme a cambio de",
  "{venden|vende|vendian|vendieron} {las|los} {medicinas|medicamentos|remedios}",
  "se {roban|robaron|llevan|llevaron} {las|los} {medicinas|medicamentos|insumos}",
  "se {apropio|apropiaron} de",
  "se {quedo|quedaron} con {el dinero|la plata}",
  "{usan|usa|usaron} {la|el} {ambulancia|carro|camioneta|vehiculo} ~ para uso personal",
  "licitacion dirigida",
  "{favorecieron|favorecio} a {una|su} empresa",
  "{compras|compra} {sobrevaloradas|sobrevalorada}",
  "{sobrevaloraron|sobrevaloro|sobrevaloracion}",
  "{contrataron|contrato} a {su|sus|la|el|los|las} {hermano|hermana|esposa|esposo|primo|prima|sobrino|sobrina|familiar|familiares}",
  "su {esposa|esposo|familiar|hermano|hermana|primo|prima} es {dueno|duena|propietario|propietaria} de ~ {farmacia|empresa}",
  "por {dinero|plata} me dijo que podia arreglar",
  "no {le|les} {cobran|cobraron|cobra|cobro} {las|la} {penalidades|penalidad}",
  "{perdonaron|perdonan|perdono} {las|la} {multas|multa}",
  "modificaron el contrato sin razon",
  "{favorece|favorecen|favorecio} a su {partido|gente|institucion}",
  "{atiende|atienden|contrata|contratan} solo a los de su partido",
  "{filtro|filtraron|filtra} informacion reservada",
  "{dio|dieron|da|dan} informacion privilegiada",
  "se hizo {rico|rica} sin que",
  "{tiene|tienen} propiedades que no justifica",
  ...FRASES_FUERTES_SIN_VERBO,
];

/**
 * Sección 4: necesitan otra señal. Además de las del léxico, "deriva a su clínica" se pasó de fuerte a media (ver el
 * README): con el médico como actor sumaba 4 (alta) y los casos límite piden media.
 */
export const FRASES_MEDIAS: readonly string[] = [
  "{cobro|cobran|cobraron|cobrar} sin {recibo|boleta|comprobante}",
  "me {cobraron|cobran|cobro} aparte",
  "me {pidieron|pidio|piden|pide} {un pago|una propina|un algo}",
  "trato preferencial",
  "favoritismo",
  "{se saltan|se saltaron|se salta} la cola",
  "{atienden|atendieron|atiende} primero a recomendados",
  "amigo del director",
  "es familiar de",
  "{lo|la} pusieron por ser {pariente|familiar}",
  "{vende|venden} junto con",
  "{se enriquecio|se enriquecieron}",
  "{camioneta|casa} que no corresponde a su sueldo",
  "me {exigio|exigieron}",
  "me {condiciono|condicionaron} la atencion a",
  "{deriva|derivan|derivo|derivaron|derivaba} ~ a su {clinica|consultorio}",
];

/** Sección 5: solo suman, nunca bastan solas. */
export const FRASES_DEBILES: readonly string[] = [
  "{corrupto|corrupta|corruptos|corruptas|corrupcion}",
  "{mafia|mafias}",
  "{negociado|negociados}",
  "abuso de poder",
  "aprovechamiento",
  "se {hacen|hace} de la vista gorda",
];

/** Sección 7, decisivas (-2): pago legítimo y delito común sin servidor. */
export const FRASES_NEGATIVAS_DECISIVAS: readonly string[] = [
  "{pague|pagamos|pagaron|pago} en caja",
  "me {dieron|dio|entregaron} {la|mi|el|un|} {boleta|recibo}",
  "con {recibo|boleta}",
  "segun el tarifario",
  "{tarifa|tasa|tarifario|tupa|precio|costo|monto} {oficial|publicada|publicado|vigente|legal|autorizada|autorizado|regular|publico}",
  "tarifa {normal|correcta}",
  "copago {del sis|}",
  "me {robaron|robo} {el|la|mi|mis} {celular|cartera|billetera|mochila|bolso}",
  "me {asaltaron|asalto}",
  "se llevaron mi mochila",
  ...NEGACIONES_DE_COBRO,
];

/** Sección 7, leves (-1): mala atención, demora y faltantes sin acusar cobro. */
export const FRASES_NEGATIVAS_LEVES: readonly string[] = [
  "{mala atencion|trato grosero|maltrato|mal trato|maltrataron}",
  "me gritaron",
  "{demora|demoras|demoraron}",
  "mucha cola",
  "{espere|esperamos|esperaron} horas",
  "cita reprogramada",
  "no {hay|habia} {medicinas|medicamentos|cama|camas}",
  "no funcionaba el equipo",
  "no me {quisieron|quiso} atender",
];

/** Palabras que engañan (sección 7): jamás son señal por sí solas, aunque una frase del léxico las contuviera. */
export const PALABRAS_QUE_ENGANAN: ReadonlySet<string> = new Set(["denuncia", "denuncias", "denunciar", "abuso", "cobro", "pago"]);

/** Antes de una frase negativa decisiva, estas palabras la invierten ("no me dieron boleta" no es un pago legítimo). */
export const PALABRAS_QUE_NIEGAN: ReadonlySet<string> = new Set(["no", "nunca", "ni", "sin"]);

/** Palabras que, justo antes de una frase de cobro, la niegan ("no me pidió plata", "nadie me cobró", "cero cobro"). */
export const NEGADORES_DE_COBRO: ReadonlySet<string> = new Set(["no", "nunca", "nadie", "ni", "tampoco", "jamas", "cero"]);

/** Dentro de la frase de cobro también la niegan: "no me condicionó ningún pago". */
export const NEGADORES_DENTRO_DEL_COBRO: ReadonlySet<string> = new Set(["ningun", "ninguna"]);

/** Las frases negativas que ya empiezan con una negación no se invierten por otra delante ("nadie me pidió plata"). */
export const INICIOS_QUE_YA_NIEGAN: ReadonlySet<string> = new Set([...NEGADORES_DE_COBRO, "sin"]);

/**
 * Frases de la familia de cobro de la v1 que se pisan con los patrones generalizables (`lexico-cobro.ts`): cuentan una sola
 * vez cuando coinciden en el mismo trozo del texto. Son plantillas tal cual están escritas arriba.
 */
export const PLANTILLAS_DE_LA_FAMILIA_DE_COBRO: ReadonlySet<string> = new Set([
  "me {pidio|pidieron|pide|piden} {dinero|plata} para",
  "me {cobraron|cobro|cobran} ~ para {darme|dar} la cita",
  "{cobran|cobraban} por {la|las} {cita|citas}",
  "{venden|vende|vendian} {las|la|los|el} {citas|cita|cupos|cupo|camas|cama}",
  "{venden|vende|vendian} {citas|cupos|camas}",
  "pagar para que me atiendan",
  "pagar para {saltar|saltarse} la cola",
  "me {ofrecio|ofrecieron} atenderme a cambio de",
  "{venden|vende|vendian|vendieron} {las|los} {medicinas|medicamentos|remedios}",
  "se {roban|robaron|llevan|llevaron} {las|los} {medicinas|medicamentos|insumos}",
  "se {apropio|apropiaron} de",
  "se {quedo|quedaron} con {el dinero|la plata}",
  "{contrataron|contrato} a {su|sus|la|el|los|las} {hermano|hermana|esposa|esposo|primo|prima|sobrino|sobrina|familiar|familiares}",
  "me {cobraron|cobran|cobro} aparte",
  "me {pidieron|pidio|piden|pide} {un pago|una propina|un algo}",
  "{atienden|atendieron|atiende} primero a recomendados",
  "me {exigio|exigieron}",
  "me {condiciono|condicionaron} la atencion a",
  "{vende|venden} junto con",
]);

/** Cargos de jefatura: quien los ocupa manda, y acusarlo (de acoso o de cobro) pide otra mirada que la del establecimiento. */
export const PALABRAS_DE_JEFATURA: ReadonlySet<string> = new Set([
  "jefe",
  "jefa",
  "director",
  "directora",
  "subdirector",
  "subdirectora",
  "administrador",
  "administradora",
  "superintendente",
  "gerente",
  "titular",
  "ministro",
  "ministra",
  "viceministro",
  "viceministra",
  "presidente",
  "presidenta",
  "coordinador",
  "coordinadora",
]);

/**
 * Acoso, hostigamiento y tocamientos (decisión del 2026-10-08): no suman al puntaje de corrupción; marcan el caso como
 * sensible, sugieren Reclamo (decide una persona) y, si acusan a un cargo mayor, piden escalarlo a OTRANS.
 */
export const FRASES_DE_ACOSO: readonly string[] = [
  "{acoso|acosa|acosan|acosaba|acosaban|acosador|acosadora|acosando|acosarme|acosarla|hostiga|hostigan|hostigaba|hostigamiento|hostigando|hostigarme|hostigador|hostigadora}",
  "{tocamiento|tocamientos|toqueteo|toqueteos|manoseo|manoseos|manosea|manosean|manosearon|toquetea|toquetean|toquetearon}",
  "me {toco|tocaron|toca|tocaba|tocaban|tocar} {la|el|las|los|mi|mis} {pierna|piernas|cintura|trasero|pecho|senos|nalgas|cuerpo|espalda|cadera|muslo|muslos|busto|cara|cabello|pelo}",
  "{le|les} {toco|tocaron|toca|tocaba|tocaban} {la|el|las|los|su|sus} {pierna|piernas|cintura|trasero|pecho|senos|nalgas|cuerpo|espalda|cadera|muslo|muslos|busto}",
  "me {agarro|agarraron|agarra|abrazo|beso|besaron|acaricio} ~ {a la fuerza|sin permiso|sin mi permiso|a la mala}",
  "se {propaso|propasaron|propasa|propasan|propasando}",
  "{propuesta|propuestas|proposiciones} {indecentes|sexuales|indecorosas}",
  "{insinuaciones|insinuacion} sexuales",
  "{comentarios|comentario|piropos|bromas} {sexuales|obscenos|morbosos|vulgares|indecentes|de doble sentido}",
  "me {miraba|mira|miran|miraban} {el cuerpo|las piernas|el trasero|el pecho|con morbo|de arriba abajo}",
  "me {escribe|escribia|manda|mandaba|mando|enviaba|envio} ~ mensajes {indecentes|sexuales|obscenos|insinuantes|fuera de horario}",
  "me {invito|invitaba|invitan|invito} a {un hotel|su casa|su cuarto|su departamento}",
  "{abuso sexual|violacion|intento de violacion|abusaron de mi|abuso de mi|intento violarme|violarme}",
];

export interface FraseDeCargo {
  plantilla: string;
  nivel: NivelCargo;
}

/** Sección 6. "ministro" sale del ejemplo del plan (3b); "director" suelto no sabe si es el cargo máximo, va como de línea. */
export const CARGOS: readonly FraseDeCargo[] = [
  ...[
    "{director|directora} {general|ejecutivo|ejecutiva}",
    "{ministro|ministra} de salud",
    "{jefe|jefa} institucional",
    "{jefe|jefa} del {instituto|sis|seguro integral de salud}",
    "{superintendente|superintendenta}",
    "{presidente|presidenta} {ejecutivo|ejecutiva}",
    "{director|directora} del hospital",
    "{director|directora} de la diris",
    "coordinador general",
    "{ministro|ministra|viceministro|viceministra}",
  ].map((plantilla) => ({ plantilla, nivel: NivelCargo.CARGO_MAXIMO })),
  ...[
    "{jefe|jefa} de {admision|emergencia|farmacia|logistica|abastecimiento|personal|servicio}",
    "{director|directora}",
    "{subdirector|subdirectora|administrador|administradora|tesorero|tesorera|cajero|cajera}",
  ].map((plantilla) => ({ plantilla, nivel: NivelCargo.CARGO_DE_LINEA })),
  ...[
    "{medico|medica|medicos|doctor|doctora|doctores}",
    "{enfermero|enfermera|enfermeros|enfermeras}",
    "{tecnico|tecnica|tecnicos|tecnicas}",
    "{obstetra|obstetras|vigilante|vigilantes|chofer|choferes}",
    "personal de {admision|farmacia}",
  ].map((plantilla) => ({ plantilla, nivel: NivelCargo.PERSONAL })),
];

/** Sección 3c: el texto menciona que tiene pruebas (foto, video, audio, documento...). */
export const FRASES_DE_PRUEBAS: readonly string[] = [
  "{prueba|pruebas|evidencia|evidencias}",
  "{foto|fotos|fotografia|fotografias|video|videos|audio|audios|grabacion|grabaciones|captura|capturas|documento|documentos}",
  "tengo {chats|mensajes|testigos|testigo}",
];
