export const USUARIOS_LIMITE_POR_DEFECTO = 50;
export const USUARIOS_LIMITE_MAXIMO = 200;
// El nombre viaja dentro del cursor (en base64): el tope es mayor que el del nombre de una persona.
export const USUARIOS_CURSOR_LONGITUD_MAXIMA = 600;
export const USUARIO_NOMBRE_LONGITUD_MINIMA = 3;
export const USUARIO_NOMBRE_LONGITUD_MAXIMA = 120;
/** Tope de usuarios activos por establecimiento: lo hace cumplir la base; aquí solo se traduce su rechazo. */
export const USUARIOS_ACTIVOS_POR_ESTABLECIMIENTO = 3;
export const USUARIO_ID_PATRON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Clave inicial que genera el sistema: larga y sin caracteres que se confundan al leerla o copiarla (0/O, 1/l/I). */
export const CLAVE_INICIAL_LONGITUD = 20;
export const CLAVE_INICIAL_ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
