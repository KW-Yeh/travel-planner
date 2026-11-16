import { legIdFor } from "../../shared/ids";
import { byPosition, keyBetween } from "../../shared/position";
import type { Day, Leg, LegMode, Stop, Trip } from "../../shared/schema";
import { dateRange } from "../../shared/time";
import { db, type TravelDB } from "../db/db";
import { newId } from "../db/ids";
import { writeRows, type Draft, type DraftChange } from "../db/mutate";

export type TripInput = {
  name: string;
  start_date: string | null;
  end_date: string | null;
  party_size: number;
  time_zone: string;
};

export const DEFAULT_DEPART = "09:00";

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

async function liveStopsOfDay(database: TravelDB, tripId: string, dayId: string | null): Promise<Stop[]> {
  const stops = await database.stops.where("trip_id").equals(tripId).toArray();
  return stops.filter((s) => s.deleted === 0 && s.day_id === dayId).sort(byPosition);
}

export async function createTrip(input: TripInput, database: TravelDB = db): Promise<string> {
  const id = newId();
  const changes: DraftChange[] = [{ table: "trips", row: { id, ...input } }];
  if (input.start_date && input.end_date) {
    for (const date of dateRange(input.start_date, input.end_date)) {
      changes.push({ table: "days", row: { id: newId(), trip_id: id, date, depart_time: DEFAULT_DEPART } });
    }
  }
  await writeRows(changes, database);
  return id;
}

/**
 * Saves trip fields and reconciles its days with the new date range: missing dates get a day,
 * days outside the range are removed and their stops move to "not scheduled" rather than vanish.
 */
export async function updateTrip(tripId: string, input: TripInput, database: TravelDB = db): Promise<void> {
  const trip = await database.trips.get(tripId);
  if (!trip) throw new Error("trip not found");
  const days = (await database.days.where("trip_id").equals(tripId).toArray()).filter((d) => d.deleted === 0);
  const wanted = input.start_date && input.end_date ? new Set(dateRange(input.start_date, input.end_date)) : new Set<string>();

  const changes: DraftChange[] = [{ table: "trips", row: { ...trip, ...input } }];
  const have = new Set(days.map((d) => d.date));
  for (const date of wanted) {
    if (!have.has(date)) changes.push({ table: "days", row: { id: newId(), trip_id: tripId, date, depart_time: DEFAULT_DEPART } });
  }
  let tail = (await liveStopsOfDay(database, tripId, null)).at(-1)?.position ?? null;
  for (const day of days) {
    if (wanted.has(day.date)) continue;
    changes.push({ table: "days", row: { ...day, deleted: 1 } });
    for (const s of await liveStopsOfDay(database, tripId, day.id)) {
      tail = keyBetween(tail, null);
      changes.push({ table: "stops", row: { ...s, day_id: null, position: tail } });
    }
  }
  await writeRows(changes, database);
}

export async function deleteTrip(tripId: string, database: TravelDB = db): Promise<void> {
  const tables = ["days", "stops", "legs", "reservations"] as const;
  const changes: DraftChange[] = [];
  const trip = await database.trips.get(tripId);
  if (trip) changes.push({ table: "trips", row: { ...trip, deleted: 1 } });
  for (const table of tables) {
    const rows = await database.syncTable(table).where("trip_id").equals(tripId).toArray();
    for (const row of rows) if (row.deleted === 0) changes.push({ table, row: { ...row, deleted: 1 } } as DraftChange);
  }
  await writeRows(changes, database);
}

export async function setDayDepart(day: Day, departTime: string, database: TravelDB = db): Promise<void> {
  await writeRows([{ table: "days", row: { ...day, depart_time: departTime } }], database);
}

/** Position for inserting at `index` among `ordered`; rewrites the day's keys if two collided. */
function positionAt(ordered: Stop[], index: number, changes: DraftChange[]): string {
  const before = ordered[index - 1]?.position ?? null;
  const after = ordered[index]?.position ?? null;
  if (before === null || after === null || before < after) return keyBetween(before, after);
  let key: string | null = null;
  let inserted = "";
  for (let i = 0; i <= ordered.length; i++) {
    key = keyBetween(key, null);
    if (i === index) {
      inserted = key;
      continue;
    }
    const s = ordered[i < index ? i : i - 1];
    if (s) changes.push({ table: "stops", row: { ...s, position: key } });
  }
  return inserted;
}

export type Placement = { dayId: string | null; at: "start" | "end" | { after: string } };

export type StopInput = Omit<Draft<"stops">, "id" | "trip_id" | "day_id" | "position">;

/** Creates or updates a stop, places it, and makes sure every consecutive pair of the affected days has a leg. */
export async function saveStop(
  tripId: string,
  stopId: string | null,
  input: StopInput,
  placement: Placement | "keep",
  database: TravelDB = db,
): Promise<string> {
  const id = stopId ?? newId();
  const existing = stopId ? await database.stops.get(stopId) : undefined;
  const changes: DraftChange[] = [];
  let dayId = existing?.day_id ?? null;
  let position = existing?.position ?? "";

  if (placement !== "keep" || !existing) {
    const target: Placement = placement === "keep" ? { dayId: null, at: "end" } : placement;
    dayId = target.dayId;
    const ordered = (await liveStopsOfDay(database, tripId, dayId)).filter((s) => s.id !== id);
    const { at } = target;
    const index =
      at === "end" ? ordered.length : at === "start" ? 0 : ordered.findIndex((s) => s.id === at.after) + 1 || ordered.length;
    position = positionAt(ordered, index, changes);
  }

  changes.push({ table: "stops", row: { ...input, id, trip_id: tripId, day_id: dayId, position } });
  await writeRows(changes, database);
  await ensureLegs(tripId, [...new Set([dayId, existing?.day_id ?? null])], database);
  return id;
}

/** Moves a stop to `toIndex` within its day. */
export async function moveStop(stop: Stop, toIndex: number, database: TravelDB = db): Promise<void> {
  const ordered = (await liveStopsOfDay(database, stop.trip_id, stop.day_id)).filter((s) => s.id !== stop.id);
  const changes: DraftChange[] = [];
  const position = positionAt(ordered, Math.max(0, Math.min(toIndex, ordered.length)), changes);
  changes.push({ table: "stops", row: { ...stop, position } });
  await writeRows(changes, database);
  await ensureLegs(stop.trip_id, [stop.day_id], database);
}

export async function deleteStop(stop: Stop, database: TravelDB = db): Promise<void> {
  const changes: DraftChange[] = [{ table: "stops", row: { ...stop, deleted: 1 } }];
  const legs = await database.legs.where("trip_id").equals(stop.trip_id).toArray();
  for (const leg of legs) {
    if (leg.deleted === 0 && (leg.from_stop_id === stop.id || leg.to_stop_id === stop.id)) {
      changes.push({ table: "legs", row: { ...leg, deleted: 1 } });
    }
  }
  const reservations = await database.reservations.where("stop_id").equals(stop.id).toArray();
  for (const r of reservations) if (r.deleted === 0) changes.push({ table: "reservations", row: { ...r, deleted: 1 } });
  await writeRows(changes, database);
  await ensureLegs(stop.trip_id, [stop.day_id], database);
}

/**
 * Every consecutive pair of a scheduled day gets a leg. A leg used before for the same pair is
 * revived with its old time, so moving a stop back restores what was there.
 */
export async function ensureLegs(tripId: string, dayIds: (string | null)[], database: TravelDB = db): Promise<void> {
  const changes: DraftChange[] = [];
  for (const dayId of dayIds) {
    if (dayId === null) continue;
    const stops = await liveStopsOfDay(database, tripId, dayId);
    for (let i = 1; i < stops.length; i++) {
      const from = stops[i - 1];
      const to = stops[i];
      if (!from || !to) continue;
      const id = await legIdFor(from.id, to.id);
      const leg = await database.legs.get(id);
      if (leg?.deleted === 0) continue;
      changes.push({
        table: "legs",
        row: leg
          ? { ...leg, deleted: 0 }
          : {
              id,
              trip_id: tripId,
              from_stop_id: from.id,
              to_stop_id: to.id,
              mode: "transit",
              minutes: null,
              steps: null,
              polyline: null,
              source: "google",
              fetched_at: null,
              query_depart_at: null,
              note: null,
            },
      });
    }
  }
  await writeRows(changes, database);
}

export async function ensureLeg(tripId: string, from: Stop, to: Stop, database: TravelDB = db): Promise<Leg> {
  await ensureLegs(tripId, [from.day_id], database);
  const leg = await database.legs.get(await legIdFor(from.id, to.id));
  if (!leg) throw new Error("leg missing after ensureLegs");
  return leg;
}

export async function setLegManual(leg: Leg, mode: LegMode, minutes: number, database: TravelDB = db): Promise<void> {
  await writeRows([{ table: "legs", row: { ...leg, mode, minutes, source: "manual", steps: null, polyline: null } }], database);
}

export async function setLegNote(leg: Leg, note: string | null, database: TravelDB = db): Promise<void> {
  await writeRows([{ table: "legs", row: { ...leg, note } }], database);
}

export async function setStay(stop: Stop, stayMinutes: number, database: TravelDB = db): Promise<void> {
  await writeRows([{ table: "stops", row: { ...stop, stay_minutes: stayMinutes } }], database);
}

export type { Trip };
