/**
 * A drawn route made of coloured pieces, stored in `legs.polyline` as JSON. Google results keep
 * a plain encoded polyline there instead; `parseTrack` tells the two apart.
 */
export type TrackSeg = { color: string | null; walk: boolean; path: string };
export type TrackInput = { color: string | null; walk: boolean; points: [number, number][] };

const VERSION = 1;

function encodeValue(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = "";
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

/** Google's encoded polyline format (precision 5); points are [lat, lng]. */
export function encodePath(points: [number, number][]): string {
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const [pLat, pLng] of points) {
    const a = Math.round(pLat * 1e5);
    const b = Math.round(pLng * 1e5);
    out += encodeValue(a - lat) + encodeValue(b - lng);
    lat = a;
    lng = b;
  }
  return out;
}

export function decodePath(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < s.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** Drops every other interior point, keeping both ends. */
function thin(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return points;
  const out = points.filter((_, i) => i % 2 === 0);
  const last = points.at(-1);
  if (last && out.at(-1) !== last) out.push(last);
  return out;
}

/** Serialises segments, thinning their points until the JSON fits in `maxLength` characters. */
export function serializeTrack(segs: TrackInput[], maxLength: number): string {
  let current = segs;
  for (;;) {
    const json = JSON.stringify({ v: VERSION, segs: current.map((s) => ({ color: s.color, walk: s.walk, path: encodePath(s.points) })) });
    if (json.length <= maxLength || current.every((s) => s.points.length <= 2)) return json;
    current = current.map((s) => ({ ...s, points: thin(s.points) }));
  }
}

export function parseTrack(polyline: string): TrackSeg[] | null {
  if (!polyline.startsWith("{")) return null;
  try {
    const data = JSON.parse(polyline) as { v?: unknown; segs?: unknown };
    if (data.v !== VERSION || !Array.isArray(data.segs)) return null;
    return data.segs.filter(
      (s): s is TrackSeg =>
        typeof s === "object" && s !== null && typeof (s as TrackSeg).path === "string" && typeof (s as TrackSeg).walk === "boolean",
    );
  } catch {
    return null;
  }
}
