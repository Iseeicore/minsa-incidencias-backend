import { DEFAULT_ERROR_MESSAGES } from "@/constants/error-messages.js";
import type { ErrorCode } from "@/enums/error-code.enum.js";
import type { HttpStatus } from "@/enums/http-status.enum.js";

export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly statusCode: HttpStatus,
    readonly errorCode: ErrorCode,
    message: string = DEFAULT_ERROR_MESSAGES[errorCode],
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}
