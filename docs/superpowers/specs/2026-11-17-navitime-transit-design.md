# NAVITIME transit routes for Japan — design

Date: 2026-11-17 · Status: approved

## Intent

Google's Routes API returns no transit routes inside Japan (its Japanese timetable data is
licensed for Google's own apps only), so transit legs in Japan end up typed in by hand. The
user wants, for each transit leg in Japan, **how to ride** (lines, transfers, walking) and
**the real track drawn on the map**. Exact timetable times are not the goal: clock times are
derived from the leg's planned departure by the app.

## Goals

- Transit legs whose both ends are in Japan are looked up with NAVITIME Route (totalnavi) via
  RapidAPI, with the real track (`shape=true`, returned in the same call, no extra quota).
- A result is reused for the same origin/destination pair, on any day and any trip, without
  calling NAVITIME again. Changing a leg's departure time never costs a NAVITIME call.
- Step clock times are computed as departure + cumulative minutes (as `StepList` already does).
- The map draws the track per section in the line's colour; walking stays grey/dashed.
- A "重新查詢" action in the leg editor forces a fresh lookup for that pair.

## Non-goals

- Exact timetable times per departure, last-train checks, live delays.
- Fares in the UI (data is there; not asked for).
- Changing how Google is used outside Japan or for drive/walk/bicycle.

## Anti-goals

- Burning the free quota (500 requests/month) through automatic re-queries.
- Exposing the RapidAPI key to the browser.

## Constraints

- Free RapidAPI plan: 500 requests/month (seen in `x-ratelimit-requests-limit`).
- `legs.polyline` is `text(200_000)`, `legs.steps` is `text(50_000)`; no migration wanted.
- NAVITIME needs coordinates; Google prefers place IDs. Stops may have both.
- **Open: NAVITIME/RapidAPI terms on storing results were not found.** The cache TTL is a
  setting (`NAVITIME_CACHE_TTL_DAYS`, default 30; `0` disables the server cache) so it can be
  turned down if the terms require it.

## Approaches

1. **Server cache keyed by the coordinate pair (picked).** Results go to the existing D1
   `route_cache` table under a key from the rounded origin/destination only. Every leg, day
   and trip with the same pair reuses it; works across devices.
2. Only keep the result on the leg row. Simple, but a second leg with the same pair (another
   day, another trip) queries again.
3. Cache per pair *and* departure bucket (as Google transit does today). Every schedule tweak
   invalidates it — the opposite of what the user asked for.

## Design

- **Provider choice (worker, `/api/routes/compare`).** For mode `transit`, when both endpoints
  carry lat/lng inside Japan's bounding box and `RAPIDAPI_KEY` is set, use NAVITIME; otherwise
  Google as today. `/api/config` reports routes enabled when either key is set.
- **Endpoints.** The client sends lat/lng alongside the place ID when the stop has both.
- **Cache key.** `sha256("navitime|<lat,lng rounded to 4 dp>|<lat,lng rounded to 4 dp>")`, per
  user, TTL `NAVITIME_CACHE_TTL_DAYS`. `refresh: true` on the request skips the cache read.
  Only `ok` / `no_route` results are stored.
- **Query time.** NAVITIME needs a start time. Use the leg's departure clock time on the next
  date (from tomorrow, JST) with the same weekday; tomorrow 09:00 JST when there is no
  departure. Whatever is first fetched is what the pair keeps.
- **Steps.** NAVITIME sections become `RouteStep`s: walking → `walk`; a ride → `transit` with
  line name, headsign (the link's destination), from/to station, and new optional fields
  `color` and `exit` (station gateway); waiting between arriving and boarding becomes an
  `other` step with mode `WAIT` so the derived clock times line up. Minutes sum to the total.
- **Track.** `legs.polyline` keeps Google's encoded polyline; for NAVITIME it holds JSON
  `{"v":1,"segs":[{"color","walk","path"}]}` where `path` is an encoded polyline. Consecutive
  GeoJSON features with the same colour/kind are merged; if the JSON exceeds the column limit,
  points are thinned until it fits. The map draws each segment in its colour.
- **Legs.** Stored with `source: "google"` (meaning "looked up", unchanged enum, no migration).
  Auto refresh stays as is: a moved departure re-asks the worker, which answers from cache.
- **UI.** Leg editor: line colour dot, exit hint, wait rows ("候車"), a "重新查詢" button for
  transit, and a "路線資料：NAVITIME" credit when the result came from NAVITIME.

## Left to the builder

Exact UI styling, test fixtures, and the thinning tolerance.
