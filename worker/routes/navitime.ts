import type { CompareRequest, Endpoint, RouteResult, RouteStep } from "../../shared/routes";
import { serializeTrack, type TrackInput } from "../../shared/track";

/** NAVITIME Route (totalnavi) through RapidAPI: transit routes with the real track, for Japan. */
export const NAVITIME_HOST = "navitime-route-totalnavi.p.rapidapi.com";

const POLYLINE_MAX = 200_000;
const JST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
/** How close (metres) a ride's track must end to its arrival station to move on to the next ride. */
const STATION_NEAR_M = 200;

/** Rough box around Japan; both ends inside it means NAVITIME instead of Google for transit. */
export function inJapan(e: Endpoint): boolean {
  return e.lat !== undefined && e.lng !== undefined && e.lat >= 24 && e.lat <= 46 && e.lng >= 122.9 && e.lng <= 146;
}

/**
 * The start time NAVITIME is asked for. Results are reused for any departure, so this only
 * picks a representative timetable: the leg's clock time on the next same weekday from
 * tomorrow (JST), or tomorrow 09:00 without a departure.
 */
export function navitimeQueryTime(departAt: number | null, now: number): string {
  const tomorrow = new Date(Math.floor((now + JST_MS) / DAY_MS) * DAY_MS + DAY_MS);
  if (departAt === null) return `${tomorrow.toISOString().slice(0, 10)}T09:00:00`;
  const local = new Date(departAt + JST_MS);
  const ahead = (local.getUTCDay() - tomorrow.getUTCDay() + 7) % 7;
  const date = new Date(tomorrow.getTime() + ahead * DAY_MS).toISOString().slice(0, 10);
  return `${date}T${local.toISOString().slice(11, 16)}:00`;
}

type Coord = { lat: number; lon: number };
type Section = {
  type?: string;
  name?: string;
  coord?: Coord;
  gateway?: string;
  move?: string;
  line_name?: string;
  from_time?: string;
  to_time?: string;
  time?: number;
  transport?: { name?: string; color?: string; links?: { destination?: { name?: string } }[] };
};
type Feature = { geometry?: { type?: string; coordinates?: [number, number][] }; properties?: { ways?: string } };
type NavitimeResponse = {
  items?: { summary?: { move?: { distance?: number } }; sections?: Section[]; shapes?: { features?: Feature[] } }[];
};

function metres(a: [number, number], b: Coord): number {
  const dLat = (a[0] - b.lat) * 111_320;
  const dLng = (a[1] - b.lon) * 111_320 * Math.cos((b.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

const minutesBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));

/** Turns a NAVITIME response into the app's route shape. */
export function normalizeNavitime(data: unknown): RouteResult {
  const item = (data as NavitimeResponse | null)?.items?.[0];
  const sections = item?.sections ?? [];
  if (!item || !sections.some((s) => s.type === "move")) return { status: "no_route" };

  const steps: RouteStep[] = [];
  const rides: { color: string | null; arrival: Coord | undefined }[] = [];
  let lastEnd: string | null = null;
  sections.forEach((s, i) => {
    if (s.type !== "move") return;
    if (lastEnd && s.from_time) {
      const wait = minutesBetween(lastEnd, s.from_time);
      if (wait > 0) steps.push({ kind: "other", mode: "WAIT", minutes: wait });
    }
    const minutes = s.from_time && s.to_time ? minutesBetween(s.from_time, s.to_time) : (s.time ?? 0);
    lastEnd = s.to_time ?? lastEnd;
    if (s.move === "walk") {
      const prev = steps.at(-1);
      if (prev?.kind === "walk") prev.minutes += minutes;
      else steps.push({ kind: "walk", minutes });
      return;
    }
    const before = sections[i - 1];
    const after = sections[i + 1];
    const color = s.transport?.color ?? null;
    rides.push({ color, arrival: after?.coord });
    steps.push({
      kind: "transit",
      minutes,
      line: s.transport?.name ?? s.line_name ?? "大眾運輸",
      vehicle: null,
      headsign: s.transport?.links?.[0]?.destination?.name ?? null,
      stops: null,
      from: before?.name ?? null,
      to: after?.name ?? null,
      departAt: null,
      color,
      exit: after?.gateway ?? null,
    });
  });

  // NAVITIME colours the track generically; give each ride its line colour, moving to the next
  // ride once the track reaches the current ride's arrival station.
  const pieces: TrackInput[] = [];
  let ride = 0;
  for (const f of item.shapes?.features ?? []) {
    if (f.geometry?.type !== "LineString" || !f.geometry.coordinates?.length) continue;
    const points = f.geometry.coordinates.map(([lng, lat]): [number, number] => [lat, lng]);
    const walk = f.properties?.ways === "walk";
    const current = rides[ride];
    const color = walk ? null : (current?.color ?? null);
    const last = pieces.at(-1);
    if (last && last.walk === walk && last.color === color) last.points.push(...points.slice(1));
    else pieces.push({ color, walk, points });
    const end = points.at(-1);
    if (!walk && current?.arrival && end && ride < rides.length - 1 && metres(end, current.arrival) < STATION_NEAR_M) ride++;
  }

  return {
    status: "ok",
    minutes: Math.max(1, steps.reduce((sum, s) => sum + s.minutes, 0)),
    distanceMeters: item.summary?.move?.distance ?? 0,
    polyline: pieces.length ? serializeTrack(pieces, POLYLINE_MAX) : null,
    steps,
    provider: "navitime",
  };
}

export async function fetchNavitime(apiKey: string, req: CompareRequest, now: number, fetcher: typeof fetch = fetch): Promise<RouteResult> {
  const { origin, destination } = req;
  if (origin.lat === undefined || origin.lng === undefined || destination.lat === undefined || destination.lng === undefined) {
    return { status: "no_route" };
  }
  const params = new URLSearchParams({
    start: `${origin.lat},${origin.lng}`,
    goal: `${destination.lat},${destination.lng}`,
    start_time: navitimeQueryTime(req.departAt, now),
    datum: "wgs84",
    coord_unit: "degree",
    limit: "1",
    shape: "true",
  });
  let res: Response;
  try {
    res = await fetcher(`https://${NAVITIME_HOST}/route_transit?${params.toString()}`, {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": NAVITIME_HOST },
    });
  } catch {
    return { status: "error", message: "network" };
  }
  if (!res.ok) {
    console.error("NAVITIME error", res.status, (await res.text()).slice(0, 500));
    return { status: "error", message: `navitime_${res.status}` };
  }
  return normalizeNavitime(await res.json());
}
