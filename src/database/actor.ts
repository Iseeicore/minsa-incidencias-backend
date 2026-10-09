export const ACTOR_SISTEMA_GESTION = "sistema:gestion";
export const ACTOR_SISTEMA_CREAR_ADMIN = "sistema:crear-admin";
/** Actor del trabajador que clasifica las incidencias con las reglas y el modelo local (B1 del plan de PoC de IA). */
export const ACTOR_SISTEMA_CLASIFICADOR = "sistema:clasificador";
export const ACTOR_SISTEMA_USUARIO_PRUEBA = "sistema:script-prueba";

export const actorUsuarioInterno = (correo: string) => `usuario:${correo}`;
