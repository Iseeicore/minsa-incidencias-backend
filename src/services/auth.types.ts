import type { ModuloCodigo } from "@/enums/modulo-codigo.enum.js";

export interface SesionActual {
  sesionId: string;
  usuarioId: string;
  correo: string;
  nombreCompleto: string;
  modulos: ModuloCodigo[];
}
