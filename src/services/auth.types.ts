import type { VistaCodigo } from "@/enums/vista-codigo.enum.js";

/**
 * La sesión de una petición. `roles` solo se usa dentro del servidor (para decidir qué casos ve la persona y
 * qué acciones puede hacer): nunca se envía al navegador.
 */
export interface SesionActual {
  sesionId: string;
  usuarioId: string;
  correo: string;
  nombreCompleto: string;
  roles: string[];
  vistas: VistaCodigo[];
}
