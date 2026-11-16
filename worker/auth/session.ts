import { hmacSign, hmacVerify, randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "tp_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The cookie carries `<token>.<hmac>`; D1 stores only SHA-256(token), so a leaked
// sessions table cannot be replayed, and the HMAC rejects forged cookies before any DB read.

export async function createSession(
  db: D1Database,
  secret: string,
  userId: string,
  userAgent: string | undefined,
  now: number,
): Promise<{ cookieValue: string; expiresAt: number }> {
  const token = randomToken();
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, expiresAt, userAgent?.slice(0, 200) ?? null)
    .run();
  return { cookieValue: `${token}.${await hmacSign(secret, token)}`, expiresAt };
}

export type ResolvedSession = { sessionId: string; userId: string; username: string };

export async function resolveSession(
  db: D1Database,
  secret: string,
  cookieValue: string | undefined,
  now: number,
): Promise<ResolvedSession | null> {
  if (!cookieValue) return null;
  const [token, signature, ...rest] = cookieValue.split(".");
  if (!token || !signature || rest.length > 0) return null;
  if (!(await hmacVerify(secret, token, signature))) return null;

  const sessionId = await sha256Hex(token);
  const row = await db
    .prepare(
      "SELECT s.user_id AS userId, u.username AS username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?",
    )
    .bind(sessionId, now)
    .first<{ userId: string; username: string }>();
  return row ? { sessionId, ...row } : null;
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function deleteExpiredSessions(db: D1Database, now: number): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
}
