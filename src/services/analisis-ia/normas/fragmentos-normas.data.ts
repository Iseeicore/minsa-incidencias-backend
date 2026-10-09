// ARCHIVO GENERADO por ia-poc/scripts/generar-normas.mjs desde ia-poc/datos/fragmentos-normas.json. No se edita a mano.
import type { DatosNormas } from "@/services/analisis-ia/normas/normas.types.js";

export const DATOS_NORMAS: DatosNormas = {
  version: "normas-v1",
  aviso:
    "Fragmentos de normas para la trazabilidad del análisis (RAG fase 1). Son una referencia orientativa: la calificación la hace OTRANS.",
  transcripcionAnexoCCotejada: false,
  avisoTranscripcion:
    "El Anexo C (20 supuestos) se transcribió a ojo desde las dos imágenes EMF del Word «Supuestos establecidos en la norma.docx», sin OCR, y no se ha cotejado con el documento oficial de la PCM. Sí se comparó con un segundo texto que pegó el usuario (ver cotejoConTextoDelUsuario). Los fragmentos de la ayuda memoria salen del texto del Word, párrafo por párrafo, con sus erratas.",
  cotejoConTextoDelUsuario: {
    fecha: "2026-10-09",
    comparados: 20,
    coincidenLiteralmente: 18,
    difierenSoloEnMayusculas: ["ANEXO_C-III-e", "ANEXO_C-III-g"],
    nota: "El usuario pegó el Anexo C como texto. 18 de 20 supuestos son idénticos palabra por palabra; III-e y III-g difieren solo en mayúsculas (la imagen trae «Enriquecimiento Ilícito» y «Negociación Incompatible»; el texto pegado, en minúscula) y se conserva la versión de la imagen. Son dos transcripciones sin el documento oficial a la vista: no sustituyen el cotejo con la PCM.",
  },
  fuentes: [
    {
      id: "DIRECTIVA_002_2023_PCM_SIP",
      nombre:
        "Directiva N° 002-2023-PCM-SIP, Directiva para la gestión de denuncias y solicitudes de medidas de protección al denunciante de actos de corrupción recibidas a través de la Plataforma Digital Única de Denuncias del Ciudadano, aprobada por Resolución de Secretaría de Integridad Pública N° 005-2023-PCM-SIP (Anexo C)",
      archivo: "Supuestos establecidos en la norma.docx",
    },
    {
      id: "AYUDA_MEMORIA_OTRANS",
      nombre:
        "AYUDA MEMORIA, Oficina de Transparencia y Anticorrupción (OTRANS) del MINSA",
      archivo: "AYUDA MEMORIA.docx",
    },
  ],
  fragmentos: [
    {
      id: "ANEXO_C-I-a",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, I, a)",
      titulo: "Conflicto de intereses",
      tipo: "FALTA",
      texto:
        "Conflicto de intereses: El servidor público mantiene relaciones en cuyo contexto sus intereses personales pudieran estar en conflicto con el cumplimiento de sus deberes y funciones.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-I-b",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, I, b)",
      titulo: "Incumplimiento del deber de cautelar los bienes del Estado",
      tipo: "FALTA",
      texto:
        "Incumplimiento del deber de cautelar los bienes del Estado: El servidor público hace uso inadecuado de los bienes del Estado asignados para el desempeño de la función pública.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-I-c",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, I, c)",
      titulo: "Incumplimiento del deber de imparcialidad",
      tipo: "FALTA",
      texto:
        "Incumplimiento del deber de imparcialidad: El servidor público en el ejercicio de su cargo favorece a las personas, partidos políticos o instituciones con las que se encuentra vinculado.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-I-d",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, I, d)",
      titulo: "Nepotismo",
      tipo: "FALTA",
      texto:
        "Nepotismo: El servidor público contrata a una persona con la que tiene parentesco hasta el cuarto grado de consanguinidad o segundo de afinidad.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-I-e",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, I, e)",
      titulo: "Ventaja indebida",
      tipo: "FALTA",
      texto:
        "Ventaja indebida: El servidor público procura u obtiene beneficios económicos o de otra índole, mediante el uso de su cargo o influencia.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-II-a",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, II, a)",
      titulo:
        "Transferencia o uso irregular del patrimonio y recursos de la entidad",
      tipo: "INCONDUCTA",
      texto:
        "El servidor público autoriza, ejecuta o influye de cualquier forma para la transferencia o uso irregular, en beneficio propio o de tercero, del patrimonio y recursos de la entidad o que están a disposición de esta, infringiendo las normas específicas que lo regulen, ocasionando perjuicio al Estado.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-II-b",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, II, b)",
      titulo: "Uso de bienes o recursos públicos incumpliendo las normas",
      tipo: "INCONDUCTA",
      texto:
        "El servidor público usa los bienes o recursos públicos incumpliendo las normas que regulan su ejecución o uso, o influye de cualquier forma para su utilización irregular, ocasionando perjuicio al Estado.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-II-c",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, II, c)",
      titulo: "Uso o disfrute irregular de bienes o recursos públicos",
      tipo: "INCONDUCTA",
      texto:
        "El servidor público usa o disfruta irregularmente los bienes o recursos públicos, para fines distintos a los que se encuentran legalmente previstos.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-II-d",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, II, d)",
      titulo:
        "Actuación parcializada en contratos, licitaciones y otros procedimientos",
      tipo: "INCONDUCTA",
      texto:
        "El servidor público actúa en forma parcializada en los contratos, licitaciones, concurso de precios, subastas, licencias, autorizaciones o cualquier otra operación o procedimiento en que participe con ocasión de su función, dando lugar a un beneficio, propio o de tercero, ocasionando perjuicio al Estado.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-II-e",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, II, e)",
      titulo: "Omisión o modificación de penalidades",
      tipo: "INCONDUCTA",
      texto:
        "El servidor público omite la aplicación o el cobro de las penalidades establecidas en la normativa que corresponda, o en contratos, convenios u otros documentos de similar naturaleza, o las modifica injustificadamente o contribuye a la inaplicación o no cobro de las mismas, generando perjuicio económico o grave afectación al servicio público.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-II-f",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, II, f)",
      titulo:
        "Beneficios o ventajas indebidas haciendo uso del cargo o de información privilegiada",
      tipo: "INCONDUCTA",
      texto:
        "El servidor público obtiene o procura beneficios o ventajas indebidas, para sí o para otro, haciendo uso de su cargo, autoridad, influencia o apariencia de influencia o suministrando información privilegiada o protegida, o incumpliendo o retrasando el ejercicio de sus funciones, ocasionando perjuicio al Estado.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-a",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, a)",
      titulo: "Cohecho activo",
      tipo: "DELITO",
      texto:
        "Cohecho activo: Paga o promete un soborno o coima a un servidor público. Lo puede cometer cualquier ciudadano, no necesita ser funcionario público.",
      citaAutomatica: false,
      motivoSinCita:
        "Lo comete quien paga: citarlo sería acusar a la persona que denuncia cuando cuenta que pagó una coima. Se deja en los datos y no se cita automáticamente.",
    },
    {
      id: "ANEXO_C-III-b",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, b)",
      titulo: "Cohecho pasivo",
      tipo: "DELITO",
      texto:
        "Cohecho pasivo: El servidor público que recibe o acepta un soborno o coima, independientemente de si este realizó o no el acto de corrupción.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-c",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, c)",
      titulo: "Colusión",
      tipo: "DELITO",
      texto:
        "Colusión: El servidor público que concierta o pacta con personas particulares en los procesos de contratación pública para defraudar al Estado.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-d",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, d)",
      titulo: "Concusión",
      tipo: "DELITO",
      texto:
        "Concusión: El servidor público que, abusando de su cargo, obliga o induce a otra persona a dar o prometer indebidamente un bien o beneficio patrimonial.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-e",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, e)",
      titulo: "Enriquecimiento ilícito",
      tipo: "DELITO",
      texto:
        "Enriquecimiento Ilícito: El servidor público que incrementa su patrimonio sin justificación en relación a sus ingresos legítimos.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-f",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, f)",
      titulo: "Malversación de fondos",
      tipo: "DELITO",
      texto:
        "Malversación de fondos: El servidor público que da uso distinto al que estaba destinado el dinero o bienes que administra, afectando el servicio o la función pública encomendada.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-g",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, g)",
      titulo: "Negociación incompatible",
      tipo: "DELITO",
      texto:
        "Negociación Incompatible: El servidor público que indebidamente, en provecho propio o de terceros, se interesa por cualquier contrato u operación en el que interviene en virtud de su cargo.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-h",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, h)",
      titulo: "Peculado",
      tipo: "DELITO",
      texto:
        "Peculado: El servidor público que se apropia de los bienes del Estado a su favor o de terceros, así como el uso indebido de los mismos para un fin distinto al que le corresponde.",
      citaAutomatica: true,
    },
    {
      id: "ANEXO_C-III-i",
      fuente: "DIRECTIVA_002_2023_PCM_SIP",
      referencia: "Directiva N° 002-2023-PCM-SIP, Anexo C, III, i)",
      titulo: "Tráfico de influencias",
      tipo: "DELITO",
      texto:
        "Tráfico de influencias: Invocación de influencias reales o simuladas ante un servidor público que conozca un caso judicial o administrativo, a cambio de recibir dinero u otro beneficio.",
      citaAutomatica: true,
    },
    {
      id: "AM-DENUNCIA-CORRUPCION",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia:
        "Ayuda memoria OTRANS, Conceptos clave, denuncia por acto de corrupción",
      titulo: "Qué es una denuncia por acto de corrupción",
      tipo: "DEFINICION",
      texto:
        "Denuncia por acto de corrupción: Comunicación verbal, escrita o virtual, individual o colectiva, que describe aquella conducta o hecho que da cuenta del abuso del poder público por parte de un servidor civil que lo ostente, con el propósito de obtener para sí o para terceros un beneficio indebido, susceptible de ser investigado en sede administrativa y/o penal.",
      citaAutomatica: true,
    },
    {
      id: "AM-CRITERIOS-DENUNCIA",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia:
        "Ayuda memoria OTRANS, Criterios de evaluación y análisis, para evaluación de una denuncia",
      titulo: "Fundamento y materialidad",
      tipo: "PROCEDIMIENTO",
      texto:
        "Fundamento: Elementos (hechos, argumentos, medios) que permiten comprobar o acreditar los hechos que se denuncian.\nMaterialidad: Relevancia e importancia de los hechos que se denuncien para la entidad siendo ello toda acción u omisión que afecte el buen funcionamiento de la administración pública, así como la confianza en las instituciones por parte de la ciudadanía, lo que justificaría el empleo de recursos de la administración pública para su preevaluación y potencial inicio de un procedimiento administrativo disciplinario a cargo de la autoridad competente.",
      citaAutomatica: true,
    },
    {
      id: "AM-REQ-HECHO-DETALLADO",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia:
        "Ayuda memoria OTRANS, Revisión de la denuncia, hecho denunciado",
      titulo: "Hecho denunciado en forma detallada",
      tipo: "PROCEDIMIENTO",
      texto:
        "Los actos materia de denuncia deben ser expuestos en forma detallada y coherente.",
      citaAutomatica: true,
    },
    {
      id: "AM-REQ-AUTORES",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia:
        "Ayuda memoria OTRANS, Revisión de la denuncia, hecho denunciado",
      titulo: "Identificación de los autores",
      tipo: "PROCEDIMIENTO",
      texto:
        "Incluir la identificación de los autores de los hechos denunciados, de conocerse.",
      citaAutomatica: true,
    },
    {
      id: "AM-REQ-ENTIDAD",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia:
        "Ayuda memoria OTRANS, Revisión de la denuncia, hecho denunciado",
      titulo: "Entidad, unidad o dependencia",
      tipo: "PROCEDIMIENTO",
      texto:
        "Indicar la entidad, unidad o dependencia de ocurrencia del hecho denunciado.",
      citaAutomatica: true,
    },
    {
      id: "AM-REQ-PRUEBAS",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia:
        "Ayuda memoria OTRANS, Revisión de la denuncia, hecho denunciado",
      titulo: "Documentación de sustento",
      tipo: "PROCEDIMIENTO",
      texto:
        "Podrá acompañarse de documentación que le dé sustento.\nDe no contar con documentación que acredite la comisión del acto de corrupción, se indica la unidad de organización que cuente con la misma, a efectos de que se incorpore en el legajo de la denuncia.",
      citaAutomatica: true,
    },
    {
      id: "AM-DERIVA-QUEJAS-RECLAMOS",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia: "Ayuda memoria OTRANS, Revisión de la denuncia, análisis",
      titulo:
        "OTRANS deriva lo que no es corrupción, las quejas y los reclamos",
      tipo: "PROCEDIMIENTO",
      texto:
        "La OTRANS deriva las denuncias que no describen un acto de corrupción, así como las quejas y los reclamos, registrando y detallando el motivo de la derivación en la PDUDC, notificando tal acto al denunciante mediante correo electrónico o servicio de mensajes cortos (SMS) de forma automática y los presentados por Mesa de Partes.",
      citaAutomatica: true,
    },
    {
      id: "AM-DERIVA-STPAD-OCI-PP",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia: "Ayuda memoria OTRANS, Revisión de la denuncia, análisis",
      titulo: "Derivación a la STPAD, al OCI o a la PP",
      tipo: "PROCEDIMIENTO",
      texto:
        "Así también, la OTRANS puede derivar a la STPAD, al OCI y/o a la PP la denuncia dependiendo de la temática solicitada y de las competencias de las dependencias antes citadas.",
      citaAutomatica: true,
    },
    {
      id: "AM-DEF-RECLAMO",
      fuente: "AYUDA_MEMORIA_OTRANS",
      referencia:
        "Ayuda memoria OTRANS, marco de SUSALUD (DS 002-2019-SA), definición de reclamo",
      titulo: "Definición de reclamo",
      tipo: "DEFINICION",
      texto:
        "RECLAMO: Manifestación verbal o escrita, efectuada ante la IAFAS, IPRESS o UGIPRESS por un usuario o tercero legitimado ante la insatisfacción respecto de los servicios, prestaciones o coberturas solicitadas o recibidas de estas, relacionadas a su atención en salud.",
      citaAutomatica: true,
    },
  ],
};
