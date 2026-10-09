const FORMATO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILISEGUNDOS_POR_DIA = 86_400_000;

/** Los milisegundos UTC de la medianoche de un día `YYYY-MM-DD`; `null` si no tiene ese formato o no es una fecha real (2026-02-31). */
export function medianocheDe(dia: string): number | null {
  const partes = FORMATO_DIA.exec(dia);
  if (!partes) return null;
  const [anio, mes, diaDelMes] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const instante = Date.UTC(anio, mes - 1, diaDelMes);
  const real = new Date(instante);
  // Date.UTC corrige lo que se pasa de rango (el 31 de febrero pasa a marzo) y los años 0-99 a 1900-1999: se compara de vuelta.
  if (real.getUTCFullYear() !== anio || real.getUTCMonth() !== mes - 1 || real.getUTCDate() !== diaDelMes) return null;
  return instante;
}

/** Cuántos días abarca el rango contando ambos extremos (un solo día es 1); puede ser menor que 1 si está invertido. */
export function diasDelRango(desde: string, hasta: string): number | null {
  const inicio = medianocheDe(desde);
  const fin = medianocheDe(hasta);
  if (inicio === null || fin === null) return null;
  return Math.round((fin - inicio) / MILISEGUNDOS_POR_DIA) + 1;
}
