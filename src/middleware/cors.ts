import cors from "cors";
import type { RequestHandler } from "express";
import type { Env } from "@/config/env.js";
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_EXPOSED_HEADERS,
  CORS_MAX_AGE_SECONDS,
} from "@/constants/limits.js";

export function createCors(env: Env): RequestHandler {
  return cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: CORS_ALLOWED_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    maxAge: CORS_MAX_AGE_SECONDS,
  });
}
