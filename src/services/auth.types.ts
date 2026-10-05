import type { VistaCodigo } from "@/enums/vista-codigo.enum.js";

export interface SesionActual {
  sesionId: string;
  usuarioId: string;
  correo: string;
  nombreCompleto: string;
  vistas: VistaCodigo[];
}
