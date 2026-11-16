import { useLiveQuery } from "dexie-react-hooks";
import { byPosition } from "../../shared/position";
import type { Day, Leg, Reservation, Stop, Trip } from "../../shared/schema";
import { db } from "../db/db";

const live = <T extends { deleted: 0 | 1 }>(rows: T[]) => rows.filter((r) => r.deleted === 0);

export function useTrips(): Trip[] | undefined {
  return useLiveQuery(async () => live(await db.trips.toArray()), []);
}

export type TripBundle = {
  trip: Trip;
  days: Day[];
  stops: Stop[];
  legs: Leg[];
  reservations: Reservation[];
};

/** Everything under one trip, live. `null` once loaded if the trip does not exist (or was deleted). */
export function useTripBundle(tripId: string | undefined): TripBundle | null | undefined {
  return useLiveQuery(async () => {
    if (!tripId) return null;
    const trip = await db.trips.get(tripId);
    if (!trip || trip.deleted === 1) return null;
    const [days, stops, legs, reservations] = await Promise.all([
      db.days.where("trip_id").equals(tripId).toArray(),
      db.stops.where("trip_id").equals(tripId).toArray(),
      db.legs.where("trip_id").equals(tripId).toArray(),
      db.reservations.where("trip_id").equals(tripId).toArray(),
    ]);
    return {
      trip,
      days: live(days).sort((a, b) => a.date.localeCompare(b.date)),
      stops: live(stops).sort(byPosition),
      legs: live(legs),
      reservations: live(reservations),
    };
  }, [tripId]);
}

/** Every trip's bundle, for the trip list's counts and conflict badges. */
export function useAllTripBundles(): TripBundle[] | undefined {
  return useLiveQuery(async () => {
    const [trips, days, stops, legs, reservations] = await Promise.all([
      db.trips.toArray(),
      db.days.toArray(),
      db.stops.toArray(),
      db.legs.toArray(),
      db.reservations.toArray(),
    ]);
    return live(trips).map((trip) => ({
      trip,
      days: live(days)
        .filter((d) => d.trip_id === trip.id)
        .sort((a, b) => a.date.localeCompare(b.date)),
      stops: live(stops)
        .filter((s) => s.trip_id === trip.id)
        .sort(byPosition),
      legs: live(legs).filter((l) => l.trip_id === trip.id),
      reservations: live(reservations).filter((r) => r.trip_id === trip.id),
    }));
  }, []);
}

export function stopsOfDay(bundle: TripBundle, dayId: string | null): Stop[] {
  return bundle.stops.filter((s) => s.day_id === dayId);
}
