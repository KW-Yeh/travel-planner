import type { LegMode } from "./schema";

type Place = { name: string; placeId: string | null; lat: number | null; lng: number | null };

const URL_MODE: Record<LegMode, string> = { transit: "transit", drive: "driving", walk: "walking", bicycle: "bicycling" };

function query(p: Place): string {
  // A name alone can be ambiguous; coordinates pin the right spot when there is no place ID.
  if (!p.placeId && p.lat !== null && p.lng !== null) return `${p.lat},${p.lng}`;
  return p.name;
}

/**
 * Google Maps directions for one leg (Maps URLs; no key, no billing). Transit directions do
 * not accept intermediate stops, so the app always links a single leg.
 */
export function directionsUrl(from: Place, to: Place, mode: LegMode): string {
  const params = new URLSearchParams({ api: "1", origin: query(from), destination: query(to), travelmode: URL_MODE[mode] });
  if (from.placeId) params.set("origin_place_id", from.placeId);
  if (to.placeId) params.set("destination_place_id", to.placeId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export type ParsedShare = { name: string | null; placeId: string | null; lat: number | null; lng: number | null };

/** Pulls a name, place ID and/or coordinates out of a (long) Google Maps URL. */
export function parseShareUrl(value: string): ParsedShare | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)google\.[a-z.]+$/.test(url.hostname)) return null;
  const out: ParsedShare = { name: null, placeId: null, lat: null, lng: null };
  const path = decodeURIComponent(url.pathname);

  const place = /\/maps\/place\/([^/]+)/.exec(path);
  if (place?.[1]) out.name = place[1].replace(/\+/g, " ");

  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(path);
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(path);
  const q = url.searchParams.get("q") ?? url.searchParams.get("query");
  const qCoords = q ? /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(q) : null;
  const coords = pin ?? qCoords ?? at;
  if (coords?.[1] && coords[2]) {
    out.lat = Number(coords[1]);
    out.lng = Number(coords[2]);
  }
  if (q && !qCoords && !out.name) out.name = q.startsWith("place_id:") ? null : q;

  const pid = url.searchParams.get("query_place_id") ?? (q?.startsWith("place_id:") ? q.slice("place_id:".length) : null);
  if (pid) out.placeId = pid;

  return out.name || out.placeId || out.lat !== null ? out : null;
}
