import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../../worker/index";
import { TEST_PASSWORD, TEST_USERNAME } from "../fixtures/credentials";
import { BASE, api, freshIp, loggedInCookie, login } from "./helpers";

const WRONG = { username: TEST_USERNAME, password: "not-the-password" }; // pragma: allowlist secret -- deliberately wrong value

describe("POST /api/auth/login", () => {
  it("sets a 30-day HttpOnly, Secure, host-only session cookie on success", async () => {
    const res = await login();
    expect(res.status).toBe(204);
    const header = res.headers.get("Set-Cookie") ?? "";
    expect(header).toMatch(/^__Host-tp_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    expect(header).toContain("Max-Age=2592000");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Domain=");
  });

  it("stores only a hash of the session token", async () => {
    const cookie = await loggedInCookie();
    const token = cookie.split("=")[1]?.split(".")[0] ?? "";
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?").bind(token).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it.each([
    ["wrong password", WRONG],
    ["wrong username", { username: "someone-else", password: TEST_PASSWORD }],
  ])("rejects a %s with 401", async (_label, body) => {
    const res = await login(body);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects a malformed body with 400 and a non-JSON body with 415", async () => {
    expect((await login({ username: "" })).status).toBe(400);
    const res = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=a&password=b",
    });
    expect(res.status).toBe(415);
  });

  it("rejects a cross-origin login with 403", async () => {
    const res = await login(undefined, { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_origin" });
  });

  it("accepts a same-origin login", async () => {
    const res = await login(undefined, { headers: { Origin: BASE } });
    expect(res.status).toBe(204);
  });

  it("locks an IP on the 5th consecutive failure, even for the right password", async () => {
    const ip = freshIp();
    for (let i = 1; i <= 4; i++) expect((await login(WRONG, { ip })).status).toBe(401);

    const fifth = await login(WRONG, { ip });
    expect(fifth.status).toBe(429);
    const body = await fifth.json<{ retryAfterSec: number }>();
    expect(body.retryAfterSec).toBe(15 * 60);
    expect(fifth.headers.get("Retry-After")).toBe(String(15 * 60));

    const correct = await login(undefined, { ip });
    expect(correct.status).toBe(429);
  });

  it("does not lock other IPs", async () => {
    const ip = freshIp();
    for (let i = 1; i <= 5; i++) await login(WRONG, { ip });
    expect((await login()).status).toBe(204);
  });

  it("resets the streak after a successful login", async () => {
    const ip = freshIp();
    for (let i = 1; i <= 4; i++) await login(WRONG, { ip });
    expect((await login(undefined, { ip })).status).toBe(204);
    for (let i = 1; i <= 4; i++) expect((await login(WRONG, { ip })).status).toBe(401);
  });

  it("returns 503 when the account is not configured", async () => {
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
      }),
      { ...env, AUTH_PASSWORD_HASH: "" },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_not_configured" });
  });
});

describe("session", () => {
  it("authenticates /api/auth/me with the cookie", async () => {
    const res = await api("/api/auth/me", { cookie: await loggedInCookie() });
    expect(res.status).toBe(200);
    const me = await res.json<{ userId: string; username: string }>();
    expect(me.username).toBe(TEST_USERNAME);
    expect(me.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps the same user id across logins", async () => {
    const a = await (await api("/api/auth/me", { cookie: await loggedInCookie() })).json<{ userId: string }>();
    const b = await (await api("/api/auth/me", { cookie: await loggedInCookie() })).json<{ userId: string }>();
    expect(a.userId).toBe(b.userId);
  });

  it.each([
    ["no cookie", undefined],
    ["garbage", "__Host-tp_session=garbage"],
    ["forged signature", "__Host-tp_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["cookie without __Host- prefix", "tp_session=x.y"],
  ])("rejects %s with 401", async (_label, cookie) => {
    const res = await api("/api/auth/me", cookie ? { cookie } : {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a tampered token even with its original signature", async () => {
    const cookie = await loggedInCookie();
    const [name, value = ""] = cookie.split("=");
    const [token = "", sig = ""] = value.split(".");
    const flipped = (token.startsWith("A") ? "B" : "A") + token.slice(1);
    const res = await api("/api/auth/me", { cookie: `${name ?? ""}=${flipped}.${sig}` });
    expect(res.status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const cookie = await loggedInCookie();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind(Date.now() - 1).run();
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("invalidates the session on logout", async () => {
    const cookie = await loggedInCookie();
    const res = await api("/api/auth/logout", { method: "POST", cookie });
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-tp_session=;.*Max-Age=0/);
    expect((await api("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("requires a session for logout", async () => {
    expect((await api("/api/auth/logout", { method: "POST" })).status).toBe(401);
  });
});
