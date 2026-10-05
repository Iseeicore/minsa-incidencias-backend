import type { SesionActual } from "@/services/auth.types.js";

declare global {
  namespace Express {
    interface Request {
      sesion?: SesionActual;
    }
    interface Locals {
      sesionInvalida?: boolean;
    }
  }
}

export {};
