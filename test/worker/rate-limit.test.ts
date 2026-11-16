import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  GLOBAL_LOCK_MS,
  GLOBAL_MAX_FAILURES,
  GLOBAL_WINDOW_MS,
  IP_BASE_LOCK_MS,
  IP_MAX_LOCK_MS,
  IP_STREAK_RESET_MS,
  globalLockRemaining,
  recordGlobalFailure,
  reserveIpAttempt,
} from "../../worker/auth/rate-limit";
import { freshIp } from "./helpers";

const T0 = 1_800_000_000_000;

/** Makes `count` failed attempts starting at `start`, one second apart; returns the last time used. */
async function fail(ip: string, count: number, start: number): Promise<number> {
  let t = start;
  for (let i = 0; i < count; i++, t += 1000) {
    const r = await reserveIpAttempt(env.DB, ip, t);
    if (!r.allowed) throw new Error(`attempt ${i + 1} unexpectedly blocked`);
  }
  return t - 1000;
}

describe("per-IP lock", () => {
  it("doubles the lock on each lockout and caps it at 24 h", async () => {
    const ip = freshIp();
    let t = T0;
    const locks: number[] = [];
    for (let lockout = 0; lockout < 9; lockout++) {
      t = await fail(ip, 5, t);
      const blocked = await reserveIpAttempt(env.DB, ip, t + 1);
      if (blocked.allowed) throw new Error("expected lock");
      locks.push(blocked.retryAfterMs + 1);
      t += blocked.retryAfterMs + 1000;
    }
    expect(locks.slice(0, 4)).toEqual([IP_BASE_LOCK_MS, 2 * IP_BASE_LOCK_MS, 4 * IP_BASE_LOCK_MS, 8 * IP_BASE_LOCK_MS]);
    expect(Math.max(...locks)).toBe(IP_MAX_LOCK_MS);
  });

  it("does not count blocked attempts towards the next lock", async () => {
    const ip = freshIp();
    const t = await fail(ip, 5, T0);
    for (let i = 0; i < 20; i++) expect((await reserveIpAttempt(env.DB, ip, t + 10 + i)).allowed).toBe(false);
    const afterLock = t + IP_BASE_LOCK_MS + 1;
    const last = await fail(ip, 4, afterLock);
    expect((await reserveIpAttempt(env.DB, ip, last + 1000)).allowed).toBe(true);
  });

  it("starts a new streak after 24 h without attempts", async () => {
    const ip = freshIp();
    const t = await fail(ip, 4, T0);
    const next = await reserveIpAttempt(env.DB, ip, t + IP_STREAK_RESET_MS + 1);
    expect(next).toEqual({ allowed: true, lockedUntil: null });
  });

  it("lets only one of many parallel attempts arm the lock", async () => {
    const ip = freshIp();
    await fail(ip, 4, T0);
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveIpAttempt(env.DB, ip, T0 + 10_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
  });
});

describe("global lock", () => {
  it("locks the account for 1 h after 50 failures within 24 h", async () => {
    const t = T0 + 100 * GLOBAL_WINDOW_MS;
    for (let i = 1; i < GLOBAL_MAX_FAILURES; i++) expect(await recordGlobalFailure(env.DB, t + i)).toBe(0);
    expect(await recordGlobalFailure(env.DB, t + GLOBAL_MAX_FAILURES)).toBe(GLOBAL_LOCK_MS);
    expect(await globalLockRemaining(env.DB, t + GLOBAL_MAX_FAILURES + 1)).toBe(GLOBAL_LOCK_MS - 1);
    expect(await globalLockRemaining(env.DB, t + GLOBAL_MAX_FAILURES + GLOBAL_LOCK_MS)).toBe(0);
  });

  it("still counts a failure exactly 24 h after the window opened", async () => {
    const t = T0 + 200 * GLOBAL_WINDOW_MS;
    for (let i = 1; i < GLOBAL_MAX_FAILURES; i++) await recordGlobalFailure(env.DB, t + i);
    const windowStart = t + 1;
    expect(await recordGlobalFailure(env.DB, windowStart + GLOBAL_WINDOW_MS)).toBe(GLOBAL_LOCK_MS);
  });

  it("forgets failures older than the 24 h window", async () => {
    const t = T0 + 300 * GLOBAL_WINDOW_MS;
    for (let i = 1; i < GLOBAL_MAX_FAILURES; i++) await recordGlobalFailure(env.DB, t + i);
    const windowStart = t + 1;
    expect(await recordGlobalFailure(env.DB, windowStart + GLOBAL_WINDOW_MS + 1)).toBe(0);
  });
});
