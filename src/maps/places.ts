import { useEffect } from "react";
import type { Stop } from "../../shared/schema";
import { updateRow } from "../db/mutate";
import { mapsLibrary, useMapsConfig, useOnline } from "./google";

/** Google allows caching Place coordinates for at most 30 days; Place IDs may be kept. */
export const PLACE_COORDS_MAX_AGE_MS = 30 * 86_400_000;
/** Refresh a little early so a trip opened right at the limit is not showing expired data. */
export const PLACE_REFRESH_AGE_MS = 25 * 86_400_000;

export function isStale(fetchedAt: number | null, now: number): boolean {
  return fetchedAt === null || now - fetchedAt > PLACE_REFRESH_AGE_MS;
}

const attempted = new Set<string>();

/** Re-fetches coordinates of Google places that are near the caching limit, once per page load. */
export function useRefreshPlaces(stops: Stop[]): void {
  const config = useMapsConfig();
  const online = useOnline();
  const key = config?.mapsBrowserKey && online ? config.mapsBrowserKey : null;
  const candidates = stops.filter((s) => s.place_id !== null);
  // Changes only when a Google place or its fetch time changes, not on every edit of the trip.
  const candidateKey = JSON.stringify(candidates.map((s) => [s.id, s.place_id, s.place_fetched_at]));

  useEffect(() => {
    if (!key) return;
    const rows = JSON.parse(candidateKey) as [string, string, number | null][];
    const now = Date.now();
    const due = rows.filter(([id, , fetchedAt]) => !attempted.has(id) && isStale(fetchedAt, now));
    if (due.length === 0) return;
    void (async () => {
      const { Place } = await mapsLibrary(key, "places");
      for (const [id, placeId] of due) {
        if (attempted.has(id)) continue;
        attempted.add(id);
        try {
          const { place } = await new Place({ id: placeId }).fetchFields({ fields: ["location", "formattedAddress"] });
          await updateRow("stops", id, {
            lat: place.location?.lat() ?? null,
            lng: place.location?.lng() ?? null,
            address: place.formattedAddress ?? null,
            place_fetched_at: Date.now(),
          });
        } catch {
          // Leave the stop as it is; the next page load tries again.
        }
      }
    })();
  }, [key, candidateKey]);
}
