import { useEffect, useRef } from "react";
import { keepsLookup, type CompareRequest, type CompareResponse, type Endpoint, type RouteResult } from "../../shared/routes";
import type { Day, Leg, LegMode, Stop, Trip } from "../../shared/schema";
import { legsToRefresh, type LegAlternative } from "../../shared/timeline";
import { apiRequest } from "../api/client";
import { db } from "../db/db";
import { writeRows } from "../db/mutate";
import type { TripBundle } from "../data/queries";
import { dayTimeline } from "../data/summary";

/** Google prefers the place ID; NAVITIME needs coordinates, so both are sent when known. */
export function endpointOf(stop: Stop): Endpoint | null {
  const coords = stop.lat !== null && stop.lng !== null ? { lat: stop.lat, lng: stop.lng } : null;
  if (stop.place_id) return { placeId: stop.place_id, ...coords };
  return coords;
}

export function compareRoutes(req: CompareRequest): Promise<CompareResponse> {
  return apiRequest<CompareResponse>("/api/routes/compare", { json: req });
}

/** Stores a Google result on the leg. A result without a time still records the attempt. */
export async function applyGoogleResult(leg: Leg, mode: LegMode, result: RouteResult, departAt: number | null): Promise<void> {
  const ok = result.status === "ok";
  await writeRows([
    {
      table: "legs",
      row: {
        ...leg,
        mode,
        source: "google",
        minutes: ok ? result.minutes : null,
        steps: ok ? JSON.stringify(result.steps) : null,
        polyline: ok ? result.polyline : null,
        fetched_at: Date.now(),
        query_depart_at: departAt,
      },
    },
  ]);
}

/**
 * Results of the last comparison per leg, kept only in memory for the conflict suggestions:
 * Google's terms do not list route results as cacheable content.
 */
const comparisons = new Map<string, { res: CompareResponse; departAt: number | null }>();

export function rememberComparison(legId: string, res: CompareResponse, departAt: number | null): void {
  comparisons.set(legId, { res, departAt });
}

export function knownAlternatives(): Map<string, LegAlternative[]> {
  const out = new Map<string, LegAlternative[]>();
  for (const [legId, { res }] of comparisons) {
    const list: LegAlternative[] = [];
    for (const [mode, r] of Object.entries(res.results)) if (r.status === "ok") list.push({ mode: mode as LegMode, minutes: r.minutes });
    out.set(legId, list);
  }
  return out;
}

/** Applies a remembered mode to a leg; false when that comparison is no longer in memory. */
export async function switchLegMode(leg: Leg, mode: LegMode): Promise<boolean> {
  const known = comparisons.get(leg.id);
  const result = known?.res.results[mode];
  if (!known || result?.status !== "ok") return false;
  await applyGoogleResult(leg, mode, result, known.departAt);
  return true;
}

/**
 * Looks up travel times for the legs of `day` that need it (new pairs, unresolved, or transit
 * whose departure moved), one mode per leg, while online and with a server key.
 */
export function useAutoRefreshLegs(bundle: TripBundle, day: Day | null, enabled: boolean): void {
  // Each (leg, reason, departure) is asked at most once per page session, so a lookup that
  // fails or returns nothing is not repeated on every re-render.
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !day || !navigator.onLine) return;
    const trip: Trip = bundle.trip;
    const work = legsToRefresh(dayTimeline(bundle, day), day.date, trip.time_zone, Date.now());
    for (const item of work) {
      const leg = item.leg;
      if (!leg) continue;
      const attemptKey = `${leg.id}:${item.reason}:${item.departAt ?? ""}`;
      if (attempted.current.has(attemptKey)) continue;
      const from = bundle.stops.find((s) => s.id === item.fromStopId);
      const to = bundle.stops.find((s) => s.id === item.toStopId);
      const origin = from && endpointOf(from);
      const destination = to && endpointOf(to);
      if (!origin || !destination) continue;
      attempted.current.add(attemptKey);
      void compareRoutes({ origin, destination, departAt: item.departAt, modes: [leg.mode] })
        .then(async (res) => {
          const result = res.results[leg.mode];
          if (!result || result.status === "error" || result.status === "not_configured") return;
          const current = await db.legs.get(leg.id);
          // The user may have switched this leg to manual while the request was out, and an
          // empty answer must not replace a route that is already saved (it would sync everywhere).
          if (current && current.source === "google" && current.deleted === 0 && keepsLookup(current, result)) {
            await applyGoogleResult(current, leg.mode, result, item.departAt);
          }
        })
        .catch(() => undefined);
    }
  }, [bundle, day, enabled]);
}
