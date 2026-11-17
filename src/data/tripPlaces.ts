import type { Stop, StopKind } from "../../shared/schema";

/** A place already used in this trip, offered again without asking Google. */
export type TripPlace = {
  key: string;
  placeId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** When Google's coordinates were fetched; kept so the 30-day refresh still applies. */
  fetchedAt: number | null;
  kind: StopKind;
};

function placeKey(s: Stop): string | null {
  if (s.place_id) return `id:${s.place_id}`;
  if (s.lat !== null && s.lng !== null) return `pin:${s.name}|${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
  return null;
}

/** This trip's located places, one per place, most recently changed first. */
export function tripPlaces(stops: Stop[], excludeId: string | null): TripPlace[] {
  const seen = new Set<string>();
  const out: TripPlace[] = [];
  for (const s of [...stops].sort((a, b) => b.updated_at - a.updated_at)) {
    if (s.id === excludeId || s.deleted === 1) continue;
    const key = placeKey(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, placeId: s.place_id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, fetchedAt: s.place_fetched_at, kind: s.kind });
  }
  return out;
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase();

/** Places whose name or address contains `text` (case- and width-insensitive). */
export function matchPlaces(places: TripPlace[], text: string): TripPlace[] {
  const q = fold(text.trim());
  if (!q) return [];
  return places.filter((p) => fold(p.name).includes(q) || (p.address !== null && fold(p.address).includes(q)));
}
