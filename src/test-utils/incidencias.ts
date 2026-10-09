import { randomUUID } from "node:crypto";
import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import type { EstablecimientoDePrueba } from "@/test-utils/establecimientos.js";
import type { RollbackContext } from "@/test-utils/rollback-database.js";

export interface OpcionesCaso {
  categoria?: CategoriaIncidencia | null;
  confianza?: number;
  revision?: "confirmada" | "corregida";
  corregidaA?: CategoriaIncidencia;
  actorRevision?: string;
  /** Establecimiento de origen del caso (donde ocurrió); sin él, el caso no tiene origen. */
  establecimiento?: EstablecimientoDePrueba;
  /** Área a la que se deriva (o en la que se toma) el caso; por defecto, la del establecimiento de origen. */
  destino?: EstablecimientoDePrueba;
  /** `ARCHIVADO` es un resuelto archivado por la vigencia de su resolución (lo hace el sistema y no se reabre). */
  estado?: "DERIVADO" | "EN_GESTION" | "RESUELTO" | "ARCHIVADO";
  /** Archiva el caso después de llevarlo a `desde` (por defecto, clasificado). El manual lo hace una persona y exige detalle. */
  archivar?: {
    desde?: "CLASIFICADO" | "DERIVADO" | "EN_GESTION";
    motivo: "DATOS_INSUFICIENTES" | "NO_CORRESPONDE" | "VENCIDA_SIN_ATENDER";
    detalle?: string;
    actor?: string;
  };
  actorDerivacion?: string;
  anonimo?: boolean;
  nombre?: string;
  dni?: string;
  evidencias?: number;
  edadHoras?: number;
  resueltoHaceHoras?: number;
  marcador?: string;
}

export interface CasoSembrado {
  id: string;
  codigo: string;
  descripcion: string;
  traceId: string;
}

/**
 * Las fechas se guardan con milisegundos: sin un margen, un caso "de 20 horas" a veces queda unos
 * microsegundos más joven y se lee como de 19. Con un minuto de margen la edad leída es siempre la pedida.
 */
const MARGEN_DE_EDAD_MINUTOS = 1;
const ACTOR_CIUDADANO = "ciudadano:prueba";
const ACTOR_IA = "sistema:ia";
const ACTOR_OPERADOR = "operador:prueba";
/** El archivo manual lo hace una persona: la base solo lo admite con un actor `usuario:`. */
const ACTOR_OPERADOR_USUARIO = "usuario:operador-prueba@minsa.gob.pe";

export const marcaDePrueba = (): string => `marca-${randomUUID()}`;

/**
 * Crea una incidencia con las mismas operaciones que usa la aplicación (la IA clasifica, una persona revisa,
 * se deriva, se atiende y se resuelve), así que la base aplica sus reglas de verdad. Solo para dar edad al caso
 * apaga los disparadores de usuario un momento. Todo queda dentro de la transacción de la prueba.
 */
export async function sembrarCaso(
  { database, client }: RollbackContext,
  opciones: OpcionesCaso = {},
): Promise<CasoSembrado> {
  const categoria = opciones.categoria === undefined ? "RECLAMO" : opciones.categoria;
  const traceId = `prueba-${randomUUID()}`;
  const waId = `prueba-wa-${randomUUID()}`;
  const descripcion = `${opciones.marcador ?? "caso de prueba"} relato ${randomUUID()}`;
  const anonimo = opciones.anonimo ?? true;

  const creado = await database.transaction(ACTOR_CIUDADANO, async (tx) => {
    const [usuario] = await tx.query<{ id: string }>("INSERT INTO chatbot.usuario (wa_id) VALUES ($1) RETURNING id", [waId]);
    const [fila] = await tx.query<{ id: string; codigo: string }>(
      `INSERT INTO chatbot.incidencia_paciente
         (canal_origen_id, usuario_id, wa_id, es_anonimo, dni_reclamante, nombre_reclamante, descripcion, trace_id, establecimiento_id)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, codigo`,
      [
        (usuario as { id: string }).id,
        waId,
        anonimo,
        anonimo ? null : (opciones.dni ?? "00001907"),
        anonimo ? null : (opciones.nombre ?? "Luis Alberto Quispe"),
        descripcion,
        traceId,
        opciones.establecimiento?.establecimientoId ?? null,
      ],
    );
    return fila as { id: string; codigo: string };
  });

  const actuar = (actor: string, sql: string, valores: unknown[]) =>
    database.transaction(actor, async (tx) => {
      await tx.query(sql, valores);
    });

  if (categoria) {
    await actuar(
      ACTOR_IA,
      `UPDATE chatbot.incidencia_paciente
          SET categoria_ia_id = (SELECT id FROM catalogo.categoria_incidencia WHERE codigo = $2),
              categoria_confianza = $3, version_clasificador = 'v-prueba'
        WHERE id = $1`,
      [creado.id, categoria, opciones.confianza ?? 58],
    );
  }

  if (opciones.revision === "confirmada") {
    await actuar(
      opciones.actorRevision ?? ACTOR_OPERADOR,
      "UPDATE chatbot.incidencia_paciente SET categoria_confirmada_en = now() WHERE id = $1",
      [creado.id],
    );
  } else if (opciones.revision === "corregida") {
    await actuar(
      opciones.actorRevision ?? ACTOR_OPERADOR,
      `UPDATE chatbot.incidencia_paciente
          SET categoria_id = (SELECT id FROM catalogo.categoria_incidencia WHERE codigo = $2)
        WHERE id = $1`,
      [creado.id, opciones.corregidaA],
    );
  }

  // Al clasificarse, la base destina el caso al área de su establecimiento de origen (la corrupción, a OTRANS). Un `destino`
  // explícito lo reasigna (solo se puede mientras el caso está clasificado o derivado); el origen solo completa lo que falte.
  const destinoExplicito = opciones.destino?.areaId ?? null;
  const origenAreaId = opciones.establecimiento?.areaId ?? null;
  const estadoPrevio = opciones.archivar ? (opciones.archivar.desde ?? "CLASIFICADO") : opciones.estado;
  if (estadoPrevio === "DERIVADO") {
    await actuar(
      opciones.actorDerivacion ?? ACTOR_OPERADOR,
      `UPDATE chatbot.incidencia_paciente
          SET estado_incidencia_id = 6, area_destino_id = COALESCE($2::int, area_destino_id, $3::int)
        WHERE id = $1`,
      [creado.id, destinoExplicito, origenAreaId],
    );
  } else if (estadoPrevio === "EN_GESTION") {
    await actuar(
      ACTOR_OPERADOR,
      `UPDATE chatbot.incidencia_paciente
          SET estado_incidencia_id = 3, area_destino_id = COALESCE($2::int, area_destino_id, $3::int)
        WHERE id = $1`,
      [creado.id, destinoExplicito, origenAreaId],
    );
  } else if (estadoPrevio === "RESUELTO" || estadoPrevio === "ARCHIVADO") {
    // Un caso resuelto pasó antes por su área: se le pone el destino si tiene categoría (OTRANS ya lo trae por la base).
    if (categoria && (destinoExplicito ?? origenAreaId) !== null) {
      await actuar(
        ACTOR_OPERADOR,
        "UPDATE chatbot.incidencia_paciente SET area_destino_id = COALESCE($2::int, area_destino_id, $3::int) WHERE id = $1",
        [creado.id, destinoExplicito, origenAreaId],
      );
    }
    await actuar(
      ACTOR_OPERADOR,
      `UPDATE chatbot.incidencia_paciente
          SET medidas_tomadas = 'Se atendió el caso en la prueba.',
              fundamento = 'El caso era procedente en la prueba.',
              resultado_resolucion_id = (SELECT id FROM catalogo.resultado_resolucion WHERE codigo = 'ATENDIDO')
        WHERE id = $1`,
      [creado.id],
    );
    if (estadoPrevio === "ARCHIVADO") {
      // Archivado por la vigencia de su resolución: lo hace el sistema y no se puede reabrir.
      await actuar("sistema:archivado", "UPDATE chatbot.incidencia_paciente SET estado_incidencia_id = 7 WHERE id = $1", [creado.id]);
    }
  }

  if (opciones.archivar) {
    const { motivo, detalle, actor } = opciones.archivar;
    if (motivo === "VENCIDA_SIN_ATENDER") {
      await actuar("sistema:vencimiento", "UPDATE chatbot.incidencia_paciente SET estado_incidencia_id = 7 WHERE id = $1", [creado.id]);
    } else {
      await actuar(
        actor ?? ACTOR_OPERADOR_USUARIO,
        `UPDATE chatbot.incidencia_paciente
            SET estado_incidencia_id = 7,
                motivo_archivo_id = (SELECT id FROM catalogo.motivo_archivo WHERE codigo = $2),
                archivo_detalle = $3
          WHERE id = $1`,
        [creado.id, motivo, detalle ?? "Archivado en la prueba por falta de datos."],
      );
    }
  }

  for (let n = 1; n <= (opciones.evidencias ?? 0); n += 1) {
    await actuar(
      ACTOR_CIUDADANO,
      `INSERT INTO chatbot.evidencia (incidencia_paciente_id, tipo_evidencia_id, mime_type, nombre_archivo, tamano, ruta)
       VALUES ($1, 1, 'image/jpeg', $2, 2048, $3)`,
      [creado.id, `foto-${n}.jpg`, `rutas-privadas/${randomUUID()}.jpg`],
    );
  }

  if (opciones.edadHoras !== undefined || opciones.resueltoHaceHoras !== undefined) {
    await client.query("ALTER TABLE chatbot.incidencia_paciente DISABLE TRIGGER USER");
    await client.query(
      `UPDATE chatbot.incidencia_paciente
          SET fecha_creacion = COALESCE(now() - make_interval(hours => $2::int, mins => $4::int), fecha_creacion),
              resuelto_en = CASE WHEN $3::int IS NULL OR resuelto_en IS NULL THEN resuelto_en
                                 ELSE now() - make_interval(hours => $3::int, mins => $4::int) END
        WHERE id = $1`,
      [creado.id, opciones.edadHoras ?? null, opciones.resueltoHaceHoras ?? null, MARGEN_DE_EDAD_MINUTOS],
    );
    await client.query("ALTER TABLE chatbot.incidencia_paciente ENABLE TRIGGER USER");
  }

  return { id: creado.id, codigo: creado.codigo, descripcion, traceId };
}
