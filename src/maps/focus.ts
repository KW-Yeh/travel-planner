import type { LatLng } from "./arc";

/** A transport stop counts as far out when it is this many times further from the centre than a typical place… */
export const OUTLIER_FACTOR = 3;
/** …and also beyond this radius, so a station just outside a compact day still shows. */
export const MIN_FOCUS_RADIUS_KM = 3;

/** `transport`: a station or airport, the only kind of place left out of the opening view. */
export type FocusPoint = LatLng & { transport: boolean };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function distanceKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6371;
}

/**
 * The places the map should frame when it opens: where the day happens, leaving out a far-away
 * station or airport that would zoom the whole map out. Sights, food and lodging always stay in.
 */
export function focusPoints<T extends FocusPoint>(points: T[]): T[] {
  if (points.length < 3) return points;
  const centre = { lat: median(points.map((p) => p.lat)), lng: median(points.map((p) => p.lng)) };
  const distances = points.map((p) => distanceKm(centre, p));
  const limit = Math.max(median(distances) * OUTLIER_FACTOR, MIN_FOCUS_RADIUS_KM);
  const kept = points.filter((p, i) => !p.transport || (distances[i] ?? 0) <= limit);
  return kept.length >= 2 ? kept : points;
}
