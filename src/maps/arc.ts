export type LatLng = { lat: number; lng: number };

/** How far the arc rises, as a share of the distance between its ends. */
export const ARC_LIFT = 0.28;
const SAMPLES = 32;

/**
 * A schematic arc between two places for a leg whose real route is unknown (typed in by hand).
 * It always bows towards the top of a north-up map so it reads as a route lifted off the ground.
 */
export function arcPath(from: LatLng, to: LatLng, lift = ARC_LIFT): LatLng[] {
  // Flatten around the midpoint so the curve keeps its shape away from the equator.
  const scale = Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180);
  const ax = from.lng * scale;
  const bx = to.lng * scale;
  const dx = bx - ax;
  const dy = to.lat - from.lat;
  const length = Math.hypot(dx, dy);
  if (length === 0) return [from, to];

  let nx = -dy / length;
  let ny = dx / length;
  if (ny < 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (ax + bx) / 2 + nx * length * lift;
  const cy = (from.lat + to.lat) / 2 + ny * length * lift;

  const out: LatLng[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx;
    const y = u * u * from.lat + 2 * u * t * cy + t * t * to.lat;
    out.push({ lat: y, lng: x / scale });
  }
  return out;
}
