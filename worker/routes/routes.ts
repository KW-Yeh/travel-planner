import { Hono } from "hono";
import { LEG_MODES, type LegMode } from "../../shared/schema";
import { CompareRequest, type CompareResponse, type ConfigResponse, type RouteResult } from "../../shared/routes";
import { sha256Hex } from "../auth/crypto";
import { apiError, readJson } from "../http";
import type { AppEnv } from "../types";
import { computeRoute } from "./google";

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
  const ttl = cacheTtlMs(c.env);
  const now = Date.now();

  const entries = await Promise.all(
    modes.map(async (mode): Promise<[LegMode, RouteResult]> => {
      if (!apiKey) return [mode, { status: "not_configured" }];
      const key = ttl > 0 ? await cacheKey(req, mode) : null;
      if (key) {
        const hit = await c.env.DB.prepare("SELECT response FROM route_cache WHERE key = ? AND user_id = ? AND expires_at > ?")
          .bind(key, userId, now)
          .first<{ response: string }>();
        if (hit) return [mode, JSON.parse(hit.response) as RouteResult];
      }
      const result = await computeRoute(apiKey, req, mode, now);
      if (key && (result.status === "ok" || result.status === "no_route")) {
        await c.env.DB.prepare(
          "INSERT INTO route_cache (key, user_id, response, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET response = excluded.response, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
        )
          .bind(key, userId, JSON.stringify(result), now, now + ttl)
          .run();
      }
      return [mode, result];
    }),
  );
  if (ttl > 0) c.executionCtx.waitUntil(c.env.DB.prepare("DELETE FROM route_cache WHERE expires_at <= ?").bind(now).run());
  return c.json<CompareResponse>({ results: Object.fromEntries(entries) });
});

export const configRoute = new Hono<AppEnv>();

configRoute.get("/", (c) =>
  c.json<ConfigResponse>({
    mapsBrowserKey: c.env.GOOGLE_MAPS_BROWSER_KEY || null,
    mapId: c.env.GOOGLE_MAP_ID || null,
    routesEnabled: Boolean(c.env.GOOGLE_ROUTES_KEY),
  }),
);
