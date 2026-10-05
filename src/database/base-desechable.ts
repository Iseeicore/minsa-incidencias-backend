const SUFIJOS_DE_BASE_DESECHABLE = ["_desechable", "_dev", "_local"];

/**
 * Solo se opera contra una base cuyo nombre termine en `_desechable`, `_dev` o `_local`. El mensaje nunca
 * incluye la URL, para no filtrar la clave.
 */
export function assertBaseDesechable(url: string): void {
  const nombre = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!SUFIJOS_DE_BASE_DESECHABLE.some((sufijo) => nombre.endsWith(sufijo))) {
    throw new Error(
      `Solo se permite operar contra una base desechable (nombre terminado en ${SUFIJOS_DE_BASE_DESECHABLE.join(", ")})`,
    );
  }
}
