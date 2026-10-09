import type { TipoArea } from "@/enums/tipo-area.enum.js";
import type { VistaCodigo } from "@/enums/vista-codigo.enum.js";

/** El área a la que pertenece la persona. El `id` solo se usa dentro del servidor, para filtrar los casos. */
export interface AreaDeSesion {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoArea;
}

/**
 * La sesión de una petición. `roles` y el `id` del área solo se usan dentro del servidor (para decidir qué casos ve
 * la persona y qué acciones puede hacer): nunca se envían al navegador.
 */
export interface SesionActual {
  sesionId: string;
  usuarioId: string;
  correo: string;
  nombreCompleto: string;
  roles: string[];
  area: AreaDeSesion | null;
  vistas: VistaCodigo[];
}
