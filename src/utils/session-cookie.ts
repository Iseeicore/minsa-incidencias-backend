import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import type { Env } from "@/config/env.js";

export const SESSION_COOKIE_NAME = "gestion_sid";

const MS_PER_SECOND = 1000;
const sessionIdSchema = z.uuid();

function baseOptions(env: Env): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  };
}

export function setSessionCookie(res: Response, env: Env, sessionId: string, maxAgeSeconds: number): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, { ...baseOptions(env), signed: true, maxAge: maxAgeSeconds * MS_PER_SECOND });
}

export function readSessionId(req: Request): string | null {
  const parsed = sessionIdSchema.safeParse(req.signedCookies?.[SESSION_COOKIE_NAME]);
  return parsed.success ? parsed.data : null;
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions(env));
}
