import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { SESSION_COOKIE, resolveSession } from "./auth/session";
import { apiError } from "./http";
import type { AppEnv } from "./types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects state-changing requests sent by another site. Browsers always attach Origin to
 * cross-site POST/PUT/DELETE; non-browser clients may omit it, and they cannot carry the
 * user's cookie anyway.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) return apiError(c, 403, "forbidden_origin");
  }
  await next();
});

/** Every API route needs a valid session except the ones listed here. */
export const PUBLIC_API_PATHS = new Set(["/api/health", "/api/auth/login"]);

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (PUBLIC_API_PATHS.has(c.req.path)) return next();
  const session = await resolveSession(
    c.env.DB,
    c.env.SESSION_SECRET,
    getCookie(c, SESSION_COOKIE, "host"),
    Date.now(),
  );
  if (!session) return apiError(c, 401, "unauthorized");
  c.set("session", session);
  await next();
});
