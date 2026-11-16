// Login throttling for a single fixed account (PLAN §9).
//
// Per IP: every 5th consecutive failed attempt locks that IP for 15 min, doubling per
// lockout up to 24 h. A streak resets after a successful login or 24 h without attempts.
// The IP attempt is counted *before* the password is checked, in one atomic statement,
// so a burst of parallel requests cannot all slip past the lock.
//
// Global: 50 failures from any IPs within a 24 h window lock the account for 1 h. This
// stops distributed guessing, at the cost that an attacker can keep the owner out of new
// logins for a while; existing sessions are unaffected.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const IP_FAILURES_PER_LOCK = 5;
export const IP_BASE_LOCK_MS = 15 * MINUTE;
export const IP_MAX_LOCK_MS = 24 * HOUR;
export const IP_STREAK_RESET_MS = 24 * HOUR;
export const GLOBAL_MAX_FAILURES = 50;
export const GLOBAL_WINDOW_MS = 24 * HOUR;
export const GLOBAL_LOCK_MS = 1 * HOUR;

const GLOBAL_KEY = "global";
const ipKey = (ip: string) => `ip:${ip}`;

type AttemptRow = { failures: number; locked_until: number | null };

/** Milliseconds until `now` is no longer locked, or 0 if not locked. */
function remaining(lockedUntil: number | null | undefined, now: number): number {
  return lockedUntil != null && lockedUntil > now ? lockedUntil - now : 0;
}

export async function globalLockRemaining(db: D1Database, now: number): Promise<number> {
  const row = await db.prepare("SELECT locked_until FROM login_attempts WHERE key = ?").bind(GLOBAL_KEY).first<AttemptRow>();
  return remaining(row?.locked_until, now);
}

export type Reservation = { allowed: true; lockedUntil: number | null } | { allowed: false; retryAfterMs: number };

/**
 * Counts one attempt from `ip` up front. If this attempt completes a block of 5 the lock
 * is armed immediately; it is lifted again by `recordSuccess` if the password was right.
 */
export async function reserveIpAttempt(db: D1Database, ip: string, now: number): Promise<Reservation> {
  // In this row, window_start holds the time of the latest attempt in the streak.
  const streak = `CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE failures + 1 END`;
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?1, 1, ?2, NULL)
       ON CONFLICT (key) DO UPDATE SET
         failures = ${streak},
         window_start = ?2,
         locked_until = CASE WHEN (${streak}) % ?4 = 0
           THEN ?2 + MIN(?5 * (1 << ((${streak}) / ?4 - 1)), ?6)
           ELSE NULL END
       WHERE locked_until IS NULL OR locked_until <= ?2
       RETURNING failures, locked_until`,
    )
    .bind(ipKey(ip), now, IP_STREAK_RESET_MS, IP_FAILURES_PER_LOCK, IP_BASE_LOCK_MS, IP_MAX_LOCK_MS)
    .first<AttemptRow>();

  if (row) return { allowed: true, lockedUntil: row.locked_until };

  const current = await db.prepare("SELECT locked_until FROM login_attempts WHERE key = ?").bind(ipKey(ip)).first<AttemptRow>();
  return { allowed: false, retryAfterMs: Math.max(remaining(current?.locked_until, now), 1000) };
}

/** Records a failure against the global budget; returns the global lock remaining, if any. */
export async function recordGlobalFailure(db: D1Database, now: number): Promise<number> {
  const count = `CASE WHEN ?2 - window_start > ?3 THEN 1 ELSE failures + 1 END`;
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?1, 1, ?2, NULL)
       ON CONFLICT (key) DO UPDATE SET
         failures = ${count},
         window_start = CASE WHEN ?2 - window_start > ?3 THEN ?2 ELSE window_start END,
         locked_until = CASE WHEN (${count}) >= ?4 THEN ?2 + ?5 ELSE locked_until END
       RETURNING failures, locked_until`,
    )
    .bind(GLOBAL_KEY, now, GLOBAL_WINDOW_MS, GLOBAL_MAX_FAILURES, GLOBAL_LOCK_MS)
    .first<AttemptRow>();
  return remaining(row?.locked_until, now);
}

export async function recordSuccess(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(ipKey(ip)).run();
}
