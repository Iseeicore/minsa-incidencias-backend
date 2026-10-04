import type { Request, RequestHandler } from "express";
import type { Env } from "@/config/env.js";
import { MAX_EMAIL_LENGTH } from "@/constants/limits.js";
import { AppError } from "@/errors/app-error.js";
import { ErrorCode } from "@/enums/error-code.enum.js";
import { HttpStatus } from "@/enums/http-status.enum.js";
import type { BucketPolicy, TokenBucketLimiter } from "@/utils/token-bucket.js";

export interface RateLimitTarget {
  key: string;
  policy: BucketPolicy;
}

export type RateLimitResolver = (req: Request) => RateLimitTarget;

export function createGeneralResolver(
  env: Env,
  getUserId: (req: Request) => string | null = () => null,
): RateLimitResolver {
  return (req) => {
    const userId = getUserId(req);
    if (userId) {
      return {
        key: `usuario:${userId}`,
        policy: { capacity: env.RATE_LIMIT_AUTH_CAPACITY, windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS },
      };
    }
    return {
      key: `ip:${req.ip ?? "desconocida"}`,
      policy: { capacity: env.RATE_LIMIT_ANON_CAPACITY, windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS },
    };
  };
}

function extractCorreo(body: unknown): string | null {
  const value = (body as { correo?: unknown } | undefined)?.correo;
  if (typeof value !== "string") return null;
  const correo = value.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
  return correo || null;
}

export function createLoginResolver(env: Env): RateLimitResolver {
  const policy = {
    capacity: env.RATE_LIMIT_LOGIN_CAPACITY,
    windowSeconds: env.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
  };
  return (req) => {
    const correo = extractCorreo(req.body);
    const key = correo ? `login:${correo}` : `login-sin-correo:${req.ip ?? "desconocida"}`;
    return { key, policy };
  };
}

export function rateLimit(limiter: TokenBucketLimiter, resolve: RateLimitResolver): RequestHandler {
  return (req, res, next) => {
    const { key, policy } = resolve(req);
    const result = limiter.take(key, policy);

    res.setHeader("RateLimit-Limit", result.limit);
    res.setHeader("RateLimit-Remaining", result.remaining);

    if (!result.allowed) {
      res.setHeader("Retry-After", result.retryAfterSeconds);
      next(new AppError(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED));
      return;
    }
    next();
  };
}
