import { randomInt } from "node:crypto";
import type { RollbackContext } from "@/test-utils/rollback-database.js";

export interface EstablecimientoDePrueba {
  establecimientoId: number;
  areaId: number;
  areaCodigo: string;
  areaNombre: string;
  codigoRenipress: string;
  nombre: string;
}

const ACTOR_PADRON = "sistema:prueba-padron";

/**
 * Crea un establecimiento con su área (tipo ESTABLECIMIENTO), como lo hace la carga del padrón. Todo queda dentro de la
 * transacción de la prueba: el código RENIPRESS (ocho dígitos, sin ceros a la izquierda) es al azar para no chocar con un padrón ya cargado en la base.
 */
export async function crearEstablecimientoDePrueba(
  { database }: RollbackContext,
  nombre = "Establecimiento de Prueba",
): Promise<EstablecimientoDePrueba> {
  const codigoRenipress = `9${randomInt(0, 10_000_000).toString().padStart(7, "0")}`;
  const areaCodigo = `EESS-${codigoRenipress}`;
  const areaNombre = `${nombre} ${codigoRenipress}`;
  return database.transaction(ACTOR_PADRON, async (tx) => {
    const [area] = await tx.query<{ id: number }>(
      `INSERT INTO catalogo.area (codigo, nombre, tipo_area_id)
       SELECT $1, $2, id FROM catalogo.tipo_area WHERE codigo = 'ESTABLECIMIENTO'
       RETURNING id`,
      [areaCodigo, areaNombre],
    );
    const [establecimiento] = await tx.query<{ id: number }>(
      `INSERT INTO catalogo.establecimiento_salud (codigo_renipress, nombre, area_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [codigoRenipress, areaNombre, (area as { id: number }).id],
    );
    return {
      establecimientoId: (establecimiento as { id: number }).id,
      areaId: (area as { id: number }).id,
      areaCodigo,
      areaNombre,
      codigoRenipress,
      nombre: areaNombre,
    };
  });
}
