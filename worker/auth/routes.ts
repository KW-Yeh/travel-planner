import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { LoginRequest, type MeResponse } from "../../shared/api";
import { verifyPassword } from "../../shared/password";
import { apiError, readJson, tooManyAttempts } from "../http";
import type { AppEnv } from "../types";
import { timingSafeStringEqual } from "./crypto";
import { globalLockRemaining, recordGlobalFailure, recordSuccess, reserveIpAttempt } from "./rate-limit";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, deleteExpiredSessions, deleteSession } from "./session";

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const parsed = LoginRequest.safeParse(body.value);
  if (!parsed.success) return apiError(c, 400, "bad_request");

  const { AUTH_USERNAME, AUTH_PASSWORD_HASH, SESSION_SECRET, DB } = c.env;
  if (!AUTH_USERNAME || !AUTH_PASSWORD_HASH || !SESSION_SECRET) {
    console.error("Login is not configured: set AUTH_USERNAME, AUTH_PASSWORD_HASH and SESSION_SECRET");
    return apiError(c, 503, "auth_not_configured");
  }

  const now = Date.now();
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

  const globalLock = await globalLockRemaining(DB, now);
  if (globalLock > 0) return tooManyAttempts(c, globalLock);

  const reservation = await reserveIpAttempt(DB, ip, now);
  if (!reservation.allowed) return tooManyAttempts(c, reservation.retryAfterMs);

  // Always run the password check so a wrong username costs the same time as a wrong password.
  const [usernameOk, passwordOk] = await Promise.all([
    timingSafeStringEqual(parsed.data.username, AUTH_USERNAME),
    verifyPassword(parsed.data.password, AUTH_PASSWORD_HASH),
  ]);

  if (!usernameOk || !passwordOk) {
    const globalAfter = await recordGlobalFailure(DB, now);
    const ipLock = reservation.lockedUntil != null ? reservation.lockedUntil - now : 0;
    const lock = Math.max(globalAfter, ipLock);
    return lock > 0 ? tooManyAttempts(c, lock) : apiError(c, 401, "invalid_credentials");
  }

  await recordSuccess(DB, ip);
  await DB.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?) ON CONFLICT (username) DO NOTHING")
    .bind(crypto.randomUUID(), AUTH_USERNAME, now)
    .run();
  const user = await DB.prepare("SELECT id FROM users WHERE username = ?").bind(AUTH_USERNAME).first<{ id: string }>();
  if (!user) throw new Error("User row missing right after upsert");

  const session = await createSession(DB, SESSION_SECRET, user.id, c.req.header("User-Agent"), now);
  setCookie(c, SESSION_COOKIE, session.cookieValue, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  c.executionCtx.waitUntil(deleteExpiredSessions(DB, now));
  return c.body(null, 204);
});

authRoutes.post("/logout", async (c) => {
  await deleteSession(c.env.DB, c.var.session.sessionId);
  deleteCookie(c, SESSION_COOKIE, { prefix: "host", path: "/", secure: true });
  return c.body(null, 204);
});

authRoutes.get("/me", (c) => {
  const { userId, username } = c.var.session;
  return c.json<MeResponse>({ userId, username });
});
