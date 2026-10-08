import { ErrorCode } from "@/enums/error-code.enum.js";

export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.VALIDATION_FAILED]: "Los datos enviados no son válidos.",
  [ErrorCode.PAYLOAD_TOO_LARGE]: "El cuerpo de la petición supera el tamaño permitido.",
  [ErrorCode.UNAUTHORIZED]: "Debes iniciar sesión.",
  [ErrorCode.INVALID_CREDENTIALS]: "Correo o contraseña incorrectos.",
  [ErrorCode.INVALID_SESSION]: "La sesión no es válida o ya terminó.",
  [ErrorCode.FORBIDDEN]: "No tienes permisos para esta acción.",
  [ErrorCode.NOT_FOUND]: "El recurso solicitado no existe.",
  [ErrorCode.CONFLICT]: "La operación entra en conflicto con el estado actual.",
  [ErrorCode.UNPROCESSABLE]: "Los datos son correctos, pero la regla de negocio impide procesarlos.",
  [ErrorCode.LIMITE_USUARIOS_ESTABLECIMIENTO]: "Este establecimiento ya tiene 3 usuarios activos. Desactiva a uno para agregar o reactivar otro.",
  [ErrorCode.CORREO_REPETIDO]: "Ya existe un usuario con ese correo.",
  [ErrorCode.AUTOEDICION_NO_PERMITIDA]: "No puedes cambiar tu propio rol ni desactivarte a ti mismo.",
  [ErrorCode.RATE_LIMITED]: "Demasiadas peticiones. Espera un momento e inténtalo de nuevo.",
  [ErrorCode.NOT_IMPLEMENTED]: "Esta funcionalidad aún no está disponible.",
  [ErrorCode.SERVICE_UNAVAILABLE]: "El servicio no está disponible en este momento.",
  [ErrorCode.INTERNAL_ERROR]: "Ocurrió un error interno. Inténtalo más tarde.",
};
