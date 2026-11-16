import { Hono } from "hono";
import { apiError, readJson } from "../http";
import type { AppEnv } from "../types";

// The Worker follows redirects only between these hosts, so this endpoint cannot be
// used to make requests to arbitrary or internal addresses.
const ALLOWED_HOST = /^(maps\.app\.goo\.gl|goo\.gl|((www|maps)\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2}))$/;
const MAX_HOPS = 5;

export function isAllowedMapsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** Follows a Google Maps share link's redirects and returns the final long URL. */
export async function resolveShareLink(start: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isAllowedMapsUrl(current)) return null;
    const res = await fetcher(current, { method: "GET", redirect: "manual" });
    const location = res.headers.get("Location");
    if (res.status < 300 || res.status >= 400 || !location) return current;
    current = new URL(location, current).href;
  }
  return null;
}

export const linkRoutes = new Hono<AppEnv>();

linkRoutes.post("/resolve", async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const url = (body.value as { url?: unknown }).url;
  if (typeof url !== "string" || url.length > 2048 || !isAllowedMapsUrl(url)) return apiError(c, 400, "bad_request");
  try {
    const resolved = await resolveShareLink(url);
    return resolved ? c.json({ url: resolved }) : apiError(c, 400, "bad_request");
  } catch {
    return apiError(c, 400, "bad_request");
  }
});
