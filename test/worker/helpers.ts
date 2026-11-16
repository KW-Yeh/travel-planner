import { exports } from "cloudflare:workers";
import { TEST_PASSWORD, TEST_USERNAME } from "../fixtures/credentials";

export const BASE = "https://planner.test";

let ipCounter = 0;
/** A fresh client IP so rate-limit state never leaks between tests. */
export function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

export function login(
  body: unknown = { username: TEST_USERNAME, password: TEST_PASSWORD },
  init: { ip?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return exports.default.fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": init.ip ?? freshIp(),
      ...init.headers,
    },
    body: JSON.stringify(body),
  });
}

/** Returns `name=value` for the session cookie set by a response. */
export function sessionCookie(res: Response): string {
  const header = res.headers.get("Set-Cookie");
  if (!header) throw new Error("No Set-Cookie header");
  const pair = header.split(";")[0];
  if (!pair) throw new Error("Malformed Set-Cookie header");
  return pair;
}

export async function loggedInCookie(): Promise<string> {
  const res = await login();
  if (res.status !== 204) throw new Error(`Login failed with ${res.status}`);
  return sessionCookie(res);
}

export function api(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  return exports.default.fetch(`${BASE}${path}`, { ...init, headers });
}
