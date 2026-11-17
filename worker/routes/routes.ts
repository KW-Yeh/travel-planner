import { Hono } from "hono";
import { LEG_MODES, type LegMode } from "../../shared/schema";
import { CompareRequest, type CompareResponse, type ConfigResponse, type RouteResult } from "../../shared/routes";
import { sha256Hex } from "../auth/crypto";
import { apiError, readJson } from "../http";
import type { AppEnv } from "../types";
import { computeRoute } from "./google";
import { fetchNavitime, inJapan } from "./navitime";

const TRANSIT_BUCKET_MS = 30 * 60_000;

/** Hours to keep route results in D1; 0 (the default) disables the cache. See PLAN §9 on Google's terms. */
function cacheTtlMs(env: Env): number {
  const hours = Number(env.ROUTE_CACHE_TTL_HOURS || "0");
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 0;
}

async function cacheKey(req: CompareRequest, mode: LegMode): Promise<string> {
  const point = (e: CompareRequest["origin"]) => e.placeId ?? `${e.lat?.toFixed(5)},${e.lng?.toFixed(5)}`;
  // Only transit depends on the departure time (no live traffic is requested for driving).
  const bucket = mode === "transit" && req.departAt !== null ? Math.floor(req.departAt / TRANSIT_BUCKET_MS) : "any";
  return sha256Hex(`${point(req.origin)}|${point(req.destination)}|${mode}|${bucket}`);
}

/** Days to keep NAVITIME results; "0" disables. Defaults to 30 (see the NAVITIME design doc). */
function navitimeTtlMs(env: Env): number {
  const days = Number(env.NAVITIME_CACHE_TTL_DAYS || "30");
  return Number.isFinite(days) && days > 0 ? days * 86_400_000 : 0;
}

/** NAVITIME results are reused for any departure: the key is the rounded coordinate pair only. */
function navitimeKey(req: CompareRequest): Promise<string> {
  const point = (e: CompareRequest["origin"]) => `${e.lat?.toFixed(4)},${e.lng?.toFixed(4)}`;
  return sha256Hex(`navitime|${point(req.origin)}|${point(req.destination)}`);
}

async function readCache(db: D1Database, key: string, userId: string, now: number): Promise<RouteResult | null> {
  const hit = await db
    .prepare("SELECT response FROM route_cache WHERE key = ? AND user_id = ? AND expires_at > ?")
    .bind(key, userId, now)
    .first<{ response: string }>();
  return hit ? (JSON.parse(hit.response) as RouteResult) : null;
}

async function writeCache(db: D1Database, key: string, userId: string, result: RouteResult, now: number, ttl: number): Promise<void> {
  if (result.status !== "ok" && result.status !== "no_route") return;
  await db
    .prepare(
      "INSERT INTO route_cache (key, user_id, response, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET response = excluded.response, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
    )
    .bind(key, userId, JSON.stringify(result), now, now + ttl)
    .run();
}

export const routeRoutes = new Hono<AppEnv>();

routeRoutes.post("/compare", async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const parsed = CompareRequest.safeParse(body.value);
  if (!parsed.success) return apiError(c, 400, "bad_request");
  const req = parsed.data;
  const modes = req.modes ?? [...LEG_MODES];
  const { userId } = c.var.session;
  const apiKey = c.env.GOOGLE_ROUTES_KEY;
  const rapidKey = c.env.RAPIDAPI_KEY;
  const ttl = cacheTtlMs(c.env);
  const navTtl = navitimeTtlMs(c.env);
  const now = Date.now();
  const useNavitime = Boolean(rapidKey) && inJapan(req.origin) && inJapan(req.destination);

  const entries = await Promise.all(
    modes.map(async (mode): Promise<[LegMode, RouteResult]> => {
      if (mode === "transit" && useNavitime && rapidKey) {
        const key = navTtl > 0 ? await navitimeKey(req) : null;
        const hit = key && !req.refresh ? await readCache(c.env.DB, key, userId, now) : null;
        if (hit) return [mode, hit];
        const result = await fetchNavitime(rapidKey, req, now);
        if (key) await writeCache(c.env.DB, key, userId, result, now, navTtl);
        return [mode, result];
      }
      if (!apiKey) return [mode, { status: "not_configured" }];
      const key = ttl > 0 ? await cacheKey(req, mode) : null;
      const hit = key && !req.refresh ? await readCache(c.env.DB, key, userId, now) : null;
      if (hit) return [mode, hit];
      const result = await computeRoute(apiKey, req, mode, now);
      if (key) await writeCache(c.env.DB, key, userId, result, now, ttl);
      return [mode, result];
    }),
  );
  if (ttl > 0 || navTtl > 0) c.executionCtx.waitUntil(c.env.DB.prepare("DELETE FROM route_cache WHERE expires_at <= ?").bind(now).run());
  return c.json<CompareResponse>({ results: Object.fromEntries(entries) });
});

export const configRoute = new Hono<AppEnv>();

configRoute.get("/", (c) =>
  c.json<ConfigResponse>({
    mapsBrowserKey: c.env.GOOGLE_MAPS_BROWSER_KEY || null,
    mapId: c.env.GOOGLE_MAP_ID || null,
    routesEnabled: Boolean(c.env.GOOGLE_ROUTES_KEY || c.env.RAPIDAPI_KEY),
  }),
);
