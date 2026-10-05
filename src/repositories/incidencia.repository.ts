import type { Database, DbExecutor } from "@/database/database.js";
import {
  ACTOR_PREFIJO_SISTEMA,
  ACTOR_PREFIJO_USUARIO,
  CATEGORIAS_CON_AREA,
  ESTADOS_ABIERTOS,
  ORDEN_SQL,
  ROL_AREA_PATRON_SQL,
} from "@/constants/incidencias.js";
import type { ReglaDeAccion } from "@/constants/permisos-por-rol.js";
import type { CategoriaIncidencia } from "@/enums/categoria-incidencia.enum.js";
import { EstadoIncidencia } from "@/enums/estado-incidencia.enum.js";
import { DireccionOrden, OrdenIncidencia } from "@/enums/orden-incidencia.enum.js";
import type { FilaHistorial } from "@/utils/historial-incidencia.js";

export interface VisibilidadCasos {
  roles: readonly string[];
  verSinCategoria: boolean;
}

export interface FiltrosDeListado {
  estado?: EstadoIncidencia;
  categoria?: CategoriaIncidencia | null;
  sinCategoria?: boolean;
  texto?: string;
  orden: OrdenIncidencia;
  direccion: DireccionOrden;
}

export interface FilaCaso {
  id: string;
  codigo: string;
  estado: EstadoIncidencia;
  categoria: CategoriaIncidencia | null;
  categoriaIa: CategoriaIncidencia | null;
  confianzaIa: number | null;
  fechaCreacion: Date;
  resueltoEn: Date | null;
  ahora: Date;
  revisada: boolean;
  corregida: boolean;
  area: string | null;
  responsable: string | null;
  resolucion: string | null;
  descripcion: string;
  esAnonimo: boolean;
  dni: string | null;
  nombre: string | null;
  canal: string;
  sensible: boolean;
}

export interface FilaEvidencia {
  nombre: string | null;
  tipo: string;
  tipoNombre: string;
  fecha: Date;
  verificada: boolean;
}

/** Reglas que definen lo que a la persona le toca atender; `null` si no actúa y cuenta todos los casos abiertos. */
export type ReglasPendientes = readonly ReglaDeAccion[] | null;

export interface ConteoPorVencer {
  total: number;
  vencidos: number;
}

/** Acumula los valores de una consulta y devuelve su marcador `$n`: nada del usuario se pega en el SQL. */
class Parametros {
  private readonly valores: unknown[] = [];

  agregar(valor: unknown): string {
    this.valores.push(valor);
    return `$${this.valores.length}`;
  }

  get lista(): unknown[] {
    return this.valores;
  }
}

const ESTADOS_CONOCIDOS: readonly EstadoIncidencia[] = Object.values(EstadoIncidencia);

const escaparComodines = (texto: string): string => texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);

const DESDE_BASICO = `
  FROM chatbot.incidencia_paciente i
  JOIN catalogo.estado_incidencia e ON e.id = i.estado_incidencia_id
  LEFT JOIN catalogo.categoria_incidencia c ON c.id = i.categoria_id`;

/**
 * Solo ve un caso quien tiene un rol activo que lo permita: la categoría del caso debe estar entre las del rol
 * (`gestion.rol_categoria`) o, si aún no tiene categoría, el rol debe poder verlos.
 */
function visibilidad(p: Parametros, visible: VisibilidadCasos): string {
  const roles = p.agregar([...visible.roles]);
  const sinCategoria = p.agregar(visible.verSinCategoria);
  return `(
    (i.categoria_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM gestion.rol_categoria rc
         JOIN gestion.rol r ON r.id = rc.rol_id AND r.activo
        WHERE r.codigo = ANY(${roles}::text[]) AND rc.categoria_incidencia_id = i.categoria_id))
    OR (i.categoria_id IS NULL AND ${sinCategoria}::boolean)
  )`;
}

function condicionesBase(p: Parametros, visible: VisibilidadCasos): string[] {
  return ["i.activo", `e.codigo = ANY(${p.agregar(ESTADOS_CONOCIDOS)}::text[])`, visibilidad(p, visible)];
}

function condicionesDeFiltros(p: Parametros, filtros: Pick<FiltrosDeListado, "estado" | "categoria" | "sinCategoria" | "texto">): string[] {
  const condiciones: string[] = [];
  if (filtros.estado) condiciones.push(`e.codigo = ${p.agregar(filtros.estado)}`);
  if (filtros.categoria) condiciones.push(`c.codigo = ${p.agregar(filtros.categoria)}`);
  if (filtros.sinCategoria) condiciones.push("i.categoria_id IS NULL");
  if (filtros.texto) {
    const patron = p.agregar(`%${escaparComodines(filtros.texto)}%`);
    condiciones.push(`(i.codigo ILIKE ${patron} ESCAPE '\\' OR i.descripcion ILIKE ${patron} ESCAPE '\\')`);
  }
  return condiciones;
}

/** Columnas y uniones de un caso. El responsable es quien derivó, o si no quien corrigió, o si no quien confirmó. */
function consultaDeCaso(p: Parametros): string {
  const derivado = p.agregar(EstadoIncidencia.DERIVADO);
  const patronDeArea = p.agregar(ROL_AREA_PATRON_SQL);
  const prefijoUsuario = p.agregar(ACTOR_PREFIJO_USUARIO);
  const prefijoSistema = p.agregar(ACTOR_PREFIJO_SISTEMA);
  return `
    SELECT i.id,
           i.codigo,
           e.codigo AS estado,
           c.codigo AS categoria,
           cia.codigo AS "categoriaIa",
           i.categoria_confianza::float8 AS "confianzaIa",
           i.fecha_creacion AS "fechaCreacion",
           i.resuelto_en AS "resueltoEn",
           now() AS ahora,
           (i.categoria_corregida_en IS NOT NULL OR i.categoria_confirmada_en IS NOT NULL) AS revisada,
           (i.categoria_corregida_en IS NOT NULL) AS corregida,
           (SELECT r.nombre
              FROM gestion.rol_categoria rc
              JOIN gestion.rol r ON r.id = rc.rol_id AND r.activo
             WHERE rc.categoria_incidencia_id = i.categoria_id AND r.codigo LIKE ${patronDeArea}
             ORDER BY r.id LIMIT 1) AS area,
           CASE WHEN ui.id IS NOT NULL THEN ui.nombre_completo
                WHEN starts_with(resp.actor, ${prefijoSistema}) THEN 'Sistema'
           END AS responsable,
           i.resolucion,
           i.descripcion,
           i.es_anonimo AS "esAnonimo",
           i.dni_reclamante AS dni,
           i.nombre_reclamante AS nombre,
           co.nombre AS canal,
           COALESCE(c.es_sensible, false) AS sensible
      FROM chatbot.incidencia_paciente i
      JOIN catalogo.estado_incidencia e ON e.id = i.estado_incidencia_id
      JOIN catalogo.canal_origen co ON co.id = i.canal_origen_id
      LEFT JOIN catalogo.categoria_incidencia c ON c.id = i.categoria_id
      LEFT JOIN catalogo.categoria_incidencia cia ON cia.id = i.categoria_ia_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(
                 (SELECT a.actor
                    FROM chatbot.incidencia_paciente_auditoria a
                   WHERE a.incidencia_paciente_id = i.id
                     AND a.operacion = 'ACTUALIZACION'
                     AND a.cambios #>> '{estado_incidencia_id,despues}' = (SELECT d.id::text FROM catalogo.estado_incidencia d WHERE d.codigo = ${derivado})
                   ORDER BY a.id DESC LIMIT 1),
                 i.categoria_corregida_por,
                 i.categoria_confirmada_por) AS actor
      ) resp ON true
      LEFT JOIN gestion.usuario_interno ui ON resp.actor = ${prefijoUsuario} || ui.correo`;
}

export class IncidenciaRepository {
  constructor(private readonly database: Database) {}

  async listar(
    visible: VisibilidadCasos,
    filtros: FiltrosDeListado,
    pagina: number,
    tamano: number,
    ejecutor: DbExecutor = this.database,
  ): Promise<{ filas: FilaCaso[]; total: number }> {
    const conteo = new Parametros();
    const condicionesDelConteo = [...condicionesBase(conteo, visible), ...condicionesDeFiltros(conteo, filtros)];
    const [resumen] = await ejecutor.query<{ total: number }>(
      `SELECT count(*)::int AS total ${DESDE_BASICO} WHERE ${condicionesDelConteo.join(" AND ")}`,
      conteo.lista,
    );

    const p = new Parametros();
    const base = consultaDeCaso(p);
    const condiciones = [...condicionesBase(p, visible), ...condicionesDeFiltros(p, filtros)];
    const sentido = filtros.direccion === DireccionOrden.DESCENDENTE ? "DESC" : "ASC";
    const limite = p.agregar(tamano);
    const desplazamiento = p.agregar((pagina - 1) * tamano);
    const filas = await ejecutor.query<FilaCaso>(
      `${base}
       WHERE ${condiciones.join(" AND ")}
       ORDER BY ${ORDEN_SQL[filtros.orden]} ${sentido} NULLS LAST, i.fecha_creacion ASC, i.codigo ASC
       LIMIT ${limite} OFFSET ${desplazamiento}`,
      p.lista,
    );
    return { filas, total: resumen?.total ?? 0 };
  }

  async buscarPorCodigo(
    codigo: string,
    visible: VisibilidadCasos,
    ejecutor: DbExecutor = this.database,
    bloquear = false,
  ): Promise<FilaCaso | null> {
    const p = new Parametros();
    const base = consultaDeCaso(p);
    const condiciones = [...condicionesBase(p, visible), `i.codigo = ${p.agregar(codigo)}`];
    const filas = await ejecutor.query<FilaCaso>(
      `${base} WHERE ${condiciones.join(" AND ")} ${bloquear ? "FOR UPDATE OF i" : ""}`,
      p.lista,
    );
    return filas[0] ?? null;
  }

  async evidencias(incidenciaId: string, ejecutor: DbExecutor = this.database): Promise<FilaEvidencia[]> {
    return ejecutor.query<FilaEvidencia>(
      `SELECT v.nombre_archivo AS nombre,
              t.codigo AS tipo,
              t.nombre AS "tipoNombre",
              v.fecha_recepcion AS fecha,
              (v.hash_archivo IS NOT NULL) AS verificada
         FROM chatbot.evidencia v
         JOIN catalogo.tipo_evidencia t ON t.id = v.tipo_evidencia_id
        WHERE v.incidencia_paciente_id = $1
        ORDER BY v.fecha_recepcion, v.id`,
      [incidenciaId],
    );
  }

  /** Solo extrae de cada cambio lo necesario para contar los hitos: nunca copia el relato ni el documento. */
  async historial(incidenciaId: string, ejecutor: DbExecutor = this.database): Promise<FilaHistorial[]> {
    return ejecutor.query<FilaHistorial>(
      `SELECT a.operacion,
              a.actor,
              ui.nombre_completo AS "actorNombre",
              a.fecha_hora AS "fechaHora",
              (a.operacion = 'ACTUALIZACION' AND a.cambios ? 'categoria_ia_id') AS ia,
              (SELECT k.codigo FROM catalogo.categoria_incidencia k
                WHERE k.id = (a.cambios #>> '{categoria_ia_id,despues}')::smallint) AS "categoriaIa",
              (a.cambios #>> '{categoria_confianza,despues}')::float8 AS confianza,
              a.cambios #>> '{version_clasificador,despues}' AS version,
              (a.operacion = 'ACTUALIZACION' AND a.cambios ? 'categoria_corregida_en') AS corregida,
              (SELECT k.codigo FROM catalogo.categoria_incidencia k
                WHERE k.id = (a.cambios #>> '{categoria_id,antes}')::smallint) AS "categoriaAntes",
              (SELECT k.codigo FROM catalogo.categoria_incidencia k
                WHERE k.id = (a.cambios #>> '{categoria_id,despues}')::smallint) AS "categoriaDespues",
              (a.operacion = 'ACTUALIZACION' AND a.cambios ? 'categoria_confirmada_en') AS confirmada,
              (SELECT s.codigo FROM catalogo.estado_incidencia s
                WHERE s.id = (a.cambios #>> '{estado_incidencia_id,despues}')::smallint) AS "estadoNuevo",
              (a.operacion = 'ACTUALIZACION' AND a.cambios ? 'resolucion') AS resolvio
         FROM chatbot.incidencia_paciente_auditoria a
         LEFT JOIN gestion.usuario_interno ui ON a.actor = $2 || ui.correo
        WHERE a.incidencia_paciente_id = $1
        ORDER BY a.id`,
      [incidenciaId, ACTOR_PREFIJO_USUARIO],
    );
  }

  async contarPorVencer(
    visible: VisibilidadCasos,
    atencionDias: number,
    avisoHoras: number,
    pendientes: ReglasPendientes,
    ejecutor: DbExecutor = this.database,
  ): Promise<ConteoPorVencer> {
    const p = new Parametros();
    const condiciones = [
      ...condicionesBase(p, visible),
      ...condicionesPorVencer(p, atencionDias, avisoHoras),
      ...condicionDePendientes(p, pendientes),
    ];
    const dias = p.agregar(atencionDias);
    const [fila] = await ejecutor.query<ConteoPorVencer>(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE i.fecha_creacion + make_interval(days => ${dias}::int) <= now()))::int AS vencidos
         ${DESDE_BASICO}
        WHERE ${condiciones.join(" AND ")}`,
      p.lista,
    );
    return fila ?? { total: 0, vencidos: 0 };
  }

  async listarPorVencer(
    visible: VisibilidadCasos,
    atencionDias: number,
    avisoHoras: number,
    limite: number,
    pendientes: ReglasPendientes,
    ejecutor: DbExecutor = this.database,
  ): Promise<FilaCaso[]> {
    const p = new Parametros();
    const base = consultaDeCaso(p);
    const condiciones = [
      ...condicionesBase(p, visible),
      ...condicionesPorVencer(p, atencionDias, avisoHoras),
      ...condicionDePendientes(p, pendientes),
    ];
    return ejecutor.query<FilaCaso>(
      `${base}
       WHERE ${condiciones.join(" AND ")}
       ORDER BY i.fecha_creacion ASC, i.codigo ASC
       LIMIT ${p.agregar(limite)}`,
      p.lista,
    );
  }

  async confirmar(tx: DbExecutor, incidenciaId: string): Promise<void> {
    await tx.query("UPDATE chatbot.incidencia_paciente SET categoria_confirmada_en = now() WHERE id = $1", [incidenciaId]);
  }

  async corregir(tx: DbExecutor, incidenciaId: string, categoria: CategoriaIncidencia): Promise<void> {
    await tx.query(
      `UPDATE chatbot.incidencia_paciente
          SET categoria_id = (SELECT k.id FROM catalogo.categoria_incidencia k WHERE k.codigo = $2 AND k.activo)
        WHERE id = $1`,
      [incidenciaId, categoria],
    );
  }

  async cambiarEstado(tx: DbExecutor, incidenciaId: string, estado: EstadoIncidencia): Promise<void> {
    await tx.query(
      `UPDATE chatbot.incidencia_paciente
          SET estado_incidencia_id = (SELECT s.id FROM catalogo.estado_incidencia s WHERE s.codigo = $2)
        WHERE id = $1`,
      [incidenciaId, estado],
    );
  }

  async resolver(tx: DbExecutor, incidenciaId: string, resolucion: string): Promise<void> {
    await tx.query("UPDATE chatbot.incidencia_paciente SET resolucion = $2 WHERE id = $1", [incidenciaId, resolucion]);
  }
}

/**
 * Deja solo los casos que a la persona le toca atender: los que cumplen alguna regla de acción de sus roles
 * (estado, categoría, si ya se revisó y si tiene área). Con `null` no filtra: cuenta todos los abiertos que ve.
 */
function condicionDePendientes(p: Parametros, reglas: ReglasPendientes): string[] {
  if (reglas === null) return [];
  if (reglas.length === 0) return ["false"];
  const alternativas = reglas.map((regla) => {
    const partes = [`e.codigo = ANY(${p.agregar([...regla.estados])}::text[])`];
    if (regla.categorias) partes.push(`c.codigo = ANY(${p.agregar([...regla.categorias])}::text[])`);
    if (regla.revisada !== undefined) {
      partes.push(`(i.categoria_corregida_en IS NOT NULL OR i.categoria_confirmada_en IS NOT NULL) = ${p.agregar(regla.revisada)}::boolean`);
    }
    if (regla.requiereArea) partes.push(`c.codigo = ANY(${p.agregar([...CATEGORIAS_CON_AREA])}::text[])`);
    return `(${partes.join(" AND ")})`;
  });
  return [`(${alternativas.join(" OR ")})`];
}

function condicionesPorVencer(p: Parametros, atencionDias: number, avisoHoras: number): string[] {
  const abiertos = p.agregar([...ESTADOS_ABIERTOS]);
  const dias = p.agregar(atencionDias);
  const horas = p.agregar(avisoHoras);
  return [
    `e.codigo = ANY(${abiertos}::text[])`,
    `i.fecha_creacion + make_interval(days => ${dias}::int) <= now() + make_interval(hours => ${horas}::int)`,
  ];
}
