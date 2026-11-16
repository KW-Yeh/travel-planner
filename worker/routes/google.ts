import type { LegMode } from "../../shared/schema";
import {
  TRANSIT_FUTURE_MS,
  TRANSIT_PAST_MS,
  type CompareRequest,
  type Endpoint,
  type RouteResult,
  type RouteStep,
} from "../../shared/routes";

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

// Every field here is billed as Compute Routes Essentials. Pro is triggered only by
// traffic-aware routing, 11+ waypoints, waypoint optimisation or location modifiers,
// none of which are ever sent (Google SKU details, checked 2026-11-16).
const FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.polyline.encodedPolyline",
  "routes.legs.steps.travelMode",
  "routes.legs.steps.staticDuration",
  "routes.legs.steps.transitDetails",
].join(",");

const TRAVEL_MODE: Record<LegMode, string> = { transit: "TRANSIT", drive: "DRIVE", walk: "WALK", bicycle: "BICYCLE" };

type GoogleStep = {
  travelMode?: string;
  staticDuration?: string;
  transitDetails?: {
    headsign?: string;
    stopCount?: number;
    stopDetails?: { departureStop?: { name?: string }; arrivalStop?: { name?: string }; departureTime?: string };
    transitLine?: { name?: string; nameShort?: string; vehicle?: { name?: { text?: string } } };
  };
};
type GoogleResponse = {
  routes?: { duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string }; legs?: { steps?: GoogleStep[] }[] }[];
};

function seconds(duration: string | undefined): number {
  return duration ? Number.parseFloat(duration.replace(/s$/, "")) || 0 : 0;
}

function toLocation(e: Endpoint) {
  return e.placeId ? { placeId: e.placeId } : { location: { latLng: { latitude: e.lat, longitude: e.lng } } };
}

/** Collapses Google's many short walking steps into one entry per stretch of walking. */
export function normalizeSteps(steps: GoogleStep[]): RouteStep[] {
  const out: RouteStep[] = [];
  let pending: { mode: string; secs: number } | null = null;
  const flush = () => {
    if (!pending) return;
    const minutes = Math.max(1, Math.round(pending.secs / 60));
    out.push(pending.mode === "WALK" ? { kind: "walk", minutes } : { kind: "other", minutes, mode: pending.mode });
    pending = null;
  };
  for (const step of steps) {
    const secs = seconds(step.staticDuration);
    if (step.travelMode === "TRANSIT" && step.transitDetails) {
      flush();
      const t = step.transitDetails;
      out.push({
        kind: "transit",
        minutes: Math.max(1, Math.round(secs / 60)),
        line: t.transitLine?.nameShort || t.transitLine?.name || "大眾運輸",
        vehicle: t.transitLine?.vehicle?.name?.text ?? null,
        headsign: t.headsign ?? null,
        stops: t.stopCount ?? null,
        from: t.stopDetails?.departureStop?.name ?? null,
        to: t.stopDetails?.arrivalStop?.name ?? null,
        departAt: t.stopDetails?.departureTime ?? null,
      });
      continue;
    }
    const mode = step.travelMode ?? "WALK";
    if (pending && pending.mode === mode) pending.secs += secs;
    else {
      flush();
      pending = { mode, secs };
    }
  }
  flush();
  return out;
}

export async function computeRoute(
  apiKey: string,
  req: CompareRequest,
  mode: LegMode,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<RouteResult> {
  const body: Record<string, unknown> = {
    origin: toLocation(req.origin),
    destination: toLocation(req.destination),
    travelMode: TRAVEL_MODE[mode],
    languageCode: "zh-TW",
    units: "METRIC",
  };
  if (mode === "transit" && req.departAt !== null) {
    if (req.departAt < now - TRANSIT_PAST_MS || req.departAt > now + TRANSIT_FUTURE_MS) return { status: "out_of_range" };
    body.departureTime = new Date(req.departAt).toISOString();
  }

  let res: Response;
  try {
    res = await fetcher(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: "error", message: "network" };
  }
  if (!res.ok) {
    // Google's error text can echo request details; only the status code leaves the Worker.
    console.error("Routes API error", res.status, (await res.text()).slice(0, 500));
    return { status: "error", message: `google_${res.status}` };
  }
  const data = await res.json<GoogleResponse>();
  const route = data.routes?.[0];
  if (!route?.duration) return { status: "no_route" };
  return {
    status: "ok",
    minutes: Math.max(1, Math.round(seconds(route.duration) / 60)),
    distanceMeters: route.distanceMeters ?? 0,
    polyline: route.polyline?.encodedPolyline ?? null,
    steps: normalizeSteps(route.legs?.flatMap((l) => l.steps ?? []) ?? []),
  };
}
