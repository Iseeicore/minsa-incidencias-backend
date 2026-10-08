import { NivelCargo } from "@/enums/filtro-corrupcion.enum.js";

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
  "me {dieron|dio|entregaron} {la|mi|} boleta",
  "con {recibo|boleta}",
  "segun el tarifario",
  "copago {del sis|}",
  "me {robaron|robo} {el|la|mi|mis} {celular|cartera|billetera|mochila|bolso}",
  "me {asaltaron|asalto}",
  "se llevaron mi mochila",
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
