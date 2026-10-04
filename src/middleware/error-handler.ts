import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, type ErrorDetail } from "@/errors/app-error.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";

export interface ErrorPayload {
  success: false;
  statusCode: HttpStatus;
  errorCode: ErrorCode;
  message: string;
  timestamp: string;
  path: string;
  details?: ErrorDetail[];
}

const BODY_PARSER_ERRORS: Record<string, AppError> = {
  "entity.parse.failed": new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED),
  "entity.too.large": new AppError(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE),
};

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return new AppError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, undefined, details);
  }
  const type = (error as { type?: unknown } | null)?.type;
  const bodyParserError = typeof type === "string" ? BODY_PARSER_ERRORS[type] : undefined;
  return bodyParserError ?? new AppError(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
}

function requestPath(req: Request): string {
  return req.originalUrl.split("?")[0] ?? req.originalUrl;
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = toAppError(error);
  if (appError.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    req.log.error({ err: error }, "error no controlado");
  }

  const payload: ErrorPayload = {
    success: false,
    statusCode: appError.statusCode,
    errorCode: appError.errorCode,
    message: appError.message,
    timestamp: new Date().toISOString(),
    path: requestPath(req),
    ...(appError.details ? { details: appError.details } : {}),
  };
  res.status(appError.statusCode).json(payload);
};
