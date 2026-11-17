# NAVITIME Transit Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transit legs inside Japan get NAVITIME routes (steps + real track), cached per origin/destination pair.

**Architecture:** The worker's `/api/routes/compare` picks NAVITIME for transit when both ends are in Japan, caches the normalised `RouteResult` in D1 keyed by the rounded coordinate pair, and returns it in the existing shape. The track is stored in `legs.polyline` as a small JSON of coloured encoded-polyline segments; the map and leg editor render it.

**Tech Stack:** Cloudflare Worker (Hono, D1), React, Google Maps JS, Vitest (+ `@cloudflare/vitest-plugin`).

**Spec:** `docs/superpowers/specs/2026-11-17-navitime-transit-design.md`

## Global Constraints

- RapidAPI host `navitime-route-totalnavi.p.rapidapi.com`, endpoint `/route_transit`, headers `x-rapidapi-key`, `x-rapidapi-host`.
- Query params: `start`, `goal` (`lat,lng`), `start_time` (`YYYY-MM-DDThh:mm:ss`, JST), `datum=wgs84`, `coord_unit=degree`, `limit=1`, `shape=true`.
- Env: `RAPIDAPI_KEY` (secret), `NAVITIME_CACHE_TTL_DAYS` (var, default `"30"`, `0` disables).
- Japan box: lat 24–46, lng 122.9–146.
- Cache key: `sha256("navitime|" + lat.toFixed(4)+","+lng.toFixed(4) + "|" + …)`.
- `legs.polyline` max 200 000 chars; no DB migration.
- The RapidAPI key never leaves the worker; NAVITIME error bodies are not returned to the client.

## Review Focus

- Departure late at night / first fetch at an odd hour → steps still sum to the total (wait steps); test in Task 1.
- Stop with only a place ID (no coords) → falls back to Google, not a crash; test in Task 2.
- Very long route (shinkansen) shape over the column limit → thinned to fit; test in Task 1.
- Moving a leg's departure → no new NAVITIME call (cache hit regardless of time); test in Task 2.
- Old Google `polyline` strings still draw → `parseTrack` returns null for non-JSON; test in Task 1.

---

### Task 1: NAVITIME client + track format

**Files:**
- Create: `shared/track.ts`, `shared/track.test.ts`, `worker/routes/navitime.ts`
- Modify: `shared/routes.ts` (optional `color`, `exit` on transit steps; optional `provider` on ok results)
- Test: `test/worker/navitime.test.ts`

**Interfaces – Produces:**
- `shared/track.ts`: `type TrackSeg = { color: string | null; walk: boolean; path: string }`; `encodePath(points: [lat, lng][]): string`; `decodePath(s: string): [lat, lng][]`; `serializeTrack(segs: { color: string | null; walk: boolean; points: [number, number][] }[], maxLength: number): string`; `parseTrack(polyline: string): TrackSeg[] | null` (null when not our JSON).
- `worker/routes/navitime.ts`: `inJapan(e: Endpoint): boolean`; `navitimeQueryTime(departAt: number | null, now: number): string`; `normalizeNavitime(data: unknown): RouteResult`; `fetchNavitime(apiKey: string, req: CompareRequest, now: number, fetcher?: typeof fetch): Promise<RouteResult>`.

- [ ] Tests: encode/decode round-trip (Google's reference `_p~iF~ps|U_ulLnnqC_mqNvxq`@` ↔ `[[38.5,-120.2],[40.7,-120.95],[43.252,-126.453]]`); `parseTrack("abc")` → null; `serializeTrack` with 20 000 points and `maxLength` 5 000 → length ≤ 5 000 and first/last point kept.
- [ ] Tests: `normalizeNavitime(fixture)` for Tokyo→Shinjuku → minutes 26, steps `walk 5, WAIT 2, transit(ＪＲ中央線快速, color #F15A22, from 東京, to 新宿, exit 八重洲中央口) 15, walk 4`, sum = 26, `provider: "navitime"`, polyline parses to ≥2 segments with the transit one coloured. Empty `items` → `no_route`. `navitimeQueryTime(null, now)` → tomorrow `T09:00:00`; with a Friday 22:30 JST departure → next Friday from tomorrow at `T22:30:00`. `inJapan` true for Tokyo, false for Taipei and for placeId-only.
- [ ] Implement; `fetchNavitime` returns `{status:"error", message:"navitime_<status>"}` on non-2xx, `network` on throw.
- [ ] `npx vitest run --project unit shared/track.test.ts` and `--project worker test/worker/navitime.test.ts` pass; commit.

### Task 2: Route NAVITIME through compare with the pair cache

**Files:**
- Modify: `worker/routes/routes.ts`, `shared/routes.ts` (`CompareRequest.refresh?: boolean`), `wrangler.jsonc` (`NAVITIME_CACHE_TTL_DAYS: "30"`), `.dev.vars.example`, `vitest.config.ts` (`RAPIDAPI_KEY: ""`), regenerate `worker/worker-configuration.d.ts` (`npm run cf-typegen`)
- Test: `test/worker/routes.test.ts`

- [ ] Tests: with `RAPIDAPI_KEY: "r"` and Japan coords, transit calls RapidAPI once for two requests with different `departAt` (cache hit), and again with `refresh: true`; with TTL `"0"` both call; placeId-only origin goes to Google (`not_configured` without Google key); `/api/config` `routesEnabled` true with only `RAPIDAPI_KEY`.
- [ ] Implement in `routes.ts`; drive/walk/bicycle untouched.
- [ ] `npm test` passes; commit.

### Task 3: Client — endpoints, refresh, editor and map

**Files:**
- Modify: `src/maps/routes.ts` (`endpointOf` returns lat/lng with placeId), `src/screens/LegEditor.tsx` (+ `.module.css`), `src/screens/MapView.tsx`

- [ ] `endpointOf` test in `src/maps/routes.test.ts`? — skip (trivial); covered by typecheck.
- [ ] LegEditor: colour dot before line name, `exit` hint (`X 出口`), `WAIT` rows labelled 候車, credit text `路線資料：NAVITIME` vs `Google 路線` by `provider` (stored legs: by `parseTrack(leg.polyline) !== null`), "重新查詢" button (transit, online, configured) re-running compare with `refresh: true`. Copy in 繁中.
- [ ] MapView: when `parseTrack(leg.polyline)` returns segs, draw each: transit in its colour (fallback day colour) weight 5 over a white casing weight 8; walk dashed in day colour.
- [ ] `npm run typecheck && npm run lint && npm test` pass; real check with the dev server and a Tokyo leg; commit; push to main.
