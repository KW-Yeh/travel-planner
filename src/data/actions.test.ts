import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { legIdFor } from "../../shared/ids";
import { byPosition } from "../../shared/position";
import { TravelDB } from "../db/db";
import { newId } from "../db/ids";
import { writeRows } from "../db/mutate";
import { createTrip, deleteStop, deleteTrip, moveStop, saveStop, updateTrip, type StopInput } from "./actions";

const databases: TravelDB[] = [];
function freshDb() {
  const d = new TravelDB(`actions-${newId()}`);
  databases.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});

const base = { party_size: 2, time_zone: "Asia/Tokyo" };
const stopInput = (name: string): StopInput => ({
  name,
  kind: "sight",
  arrival_mode: "auto",
  fixed_time: null,
  stay_minutes: 60,
  place_id: null,
  address: null,
  lat: null,
  lng: null,
  place_fetched_at: null,
  note: null,
});

async function dayStops(d: TravelDB, dayId: string | null) {
  return (await d.stops.toArray()).filter((s) => s.deleted === 0 && s.day_id === dayId).sort(byPosition);
}

async function setup() {
  const d = freshDb();
  const tripId = await createTrip({ name: "京都", start_date: "2027-03-26", end_date: "2027-03-28", ...base }, d);
  const days = (await d.days.toArray()).sort((a, b) => a.date.localeCompare(b.date));
  return { d, tripId, days };
}

describe("trip actions", () => {
  it("creates one day per date, and none for an undated trip", async () => {
    const { d, days } = await setup();
    expect(days.map((x) => [x.date, x.depart_time])).toEqual([
      ["2027-03-26", "09:00"],
      ["2027-03-27", "09:00"],
      ["2027-03-28", "09:00"],
    ]);
    await createTrip({ name: "台南", start_date: null, end_date: null, ...base }, d);
    expect(await d.days.count()).toBe(3);
  });

  it("moves stops of removed dates to 'not scheduled' when the range shrinks", async () => {
    const { d, tripId, days } = await setup();
    const day3 = days[2];
    if (!day3) throw new Error("fixture");
    await saveStop(tripId, null, stopInput("機場"), { dayId: day3.id, at: "end" }, d);
    await updateTrip(tripId, { name: "京都", start_date: "2027-03-26", end_date: "2027-03-27", ...base }, d);
    expect((await d.days.get(day3.id))?.deleted).toBe(1);
    expect((await dayStops(d, null)).map((s) => s.name)).toEqual(["機場"]);

    await updateTrip(tripId, { name: "京都", start_date: "2027-03-25", end_date: "2027-03-27", ...base }, d);
    const live = (await d.days.toArray()).filter((x) => x.deleted === 0).map((x) => x.date).sort();
    expect(live).toEqual(["2027-03-25", "2027-03-26", "2027-03-27"]);
  });

  it("soft-deletes a trip with everything under it", async () => {
    const { d, tripId, days } = await setup();
    await saveStop(tripId, null, stopInput("a"), { dayId: days[0]?.id ?? null, at: "end" }, d);
    await saveStop(tripId, null, stopInput("b"), { dayId: days[0]?.id ?? null, at: "end" }, d);
    await deleteTrip(tripId, d);
    for (const table of [d.trips, d.days, d.stops, d.legs] as const) {
      expect((await table.toArray()).every((r) => r.deleted === 1)).toBe(true);
    }
  });
});

describe("stop actions", () => {
  it("places stops at the end, at the start and after a given stop, creating legs between them", async () => {
    const { d, tripId, days } = await setup();
    const dayId = days[0]?.id ?? null;
    const a = await saveStop(tripId, null, stopInput("a"), { dayId, at: "end" }, d);
    await saveStop(tripId, null, stopInput("c"), { dayId, at: "end" }, d);
    await saveStop(tripId, null, stopInput("start"), { dayId, at: "start" }, d);
    await saveStop(tripId, null, stopInput("b"), { dayId, at: { after: a } }, d);
    const ordered = await dayStops(d, dayId);
    expect(ordered.map((s) => s.name)).toEqual(["start", "a", "b", "c"]);

    const live = (await d.legs.toArray()).filter((l) => l.deleted === 0);
    for (let i = 1; i < ordered.length; i++) {
      const id = await legIdFor(ordered[i - 1]?.id ?? "", ordered[i]?.id ?? "");
      expect(live.map((l) => l.id)).toContain(id);
    }
  });

  it("moves a stop within its day and revives the old leg when moved back", async () => {
    const { d, tripId, days } = await setup();
    const dayId = days[0]?.id ?? null;
    for (const name of ["a", "b", "c"]) await saveStop(tripId, null, stopInput(name), { dayId, at: "end" }, d);
    const [a, b] = await dayStops(d, dayId);
    if (!a || !b) throw new Error("fixture");
    const abId = await legIdFor(a.id, b.id);
    const ab = await d.legs.get(abId);
    if (!ab) throw new Error("fixture");
    await writeRows([{ table: "legs", row: { ...ab, minutes: 12, source: "manual" } }], d);

    await moveStop(a, 2, d);
    expect((await dayStops(d, dayId)).map((s) => s.name)).toEqual(["b", "c", "a"]);

    const moved = (await dayStops(d, dayId)).find((s) => s.id === a.id);
    if (!moved) throw new Error("fixture");
    await moveStop(moved, 0, d);
    expect((await dayStops(d, dayId)).map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect((await d.legs.get(abId))?.minutes).toBe(12);
  });

  it("repairs colliding positions from concurrent inserts", async () => {
    const { d, tripId, days } = await setup();
    const dayId = days[0]?.id ?? null;
    const created = await saveStop(tripId, null, stopInput("x"), { dayId, at: "end" }, d);
    const original = await d.stops.get(created);
    if (!original) throw new Error("fixture");
    // Two devices inserted at the same spot: same position, ordered only by id.
    const [lowId, highId] = [newId(), newId()].sort();
    if (!lowId || !highId) throw new Error("fixture");
    await writeRows(
      [
        { table: "stops", row: { ...original, deleted: 1 } },
        { table: "stops", row: { ...original, id: lowId, name: "x" } },
        { table: "stops", row: { ...original, id: highId, name: "y" } },
      ],
      d,
    );
    await saveStop(tripId, null, stopInput("between"), { dayId, at: { after: lowId } }, d);
    const ordered = await dayStops(d, dayId);
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered.map((s) => s.position)).size).toBe(3);
    expect(ordered.map((s) => s.name)).toEqual(["x", "between", "y"]);
  });

  it("deletes a stop with its legs and reservations, then links its neighbours", async () => {
    const { d, tripId, days } = await setup();
    const dayId = days[0]?.id ?? null;
    for (const name of ["a", "b", "c"]) await saveStop(tripId, null, stopInput(name), { dayId, at: "end" }, d);
    const [a, b, c] = await dayStops(d, dayId);
    if (!a || !b || !c) throw new Error("fixture");
    await writeRows(
      [{ table: "reservations", row: { id: newId(), trip_id: tripId, stop_id: b.id, time: "12:00", party_size: 2, code: null, url: null, status: "confirmed" } }],
      d,
    );
    await deleteStop(b, d);
    const legs = (await d.legs.toArray()).filter((l) => l.deleted === 0);
    expect(legs.map((l) => [l.from_stop_id, l.to_stop_id])).toEqual([[a.id, c.id]]);
    expect((await d.reservations.toArray()).every((r) => r.deleted === 1)).toBe(true);
  });

  it("derives the same leg id on every device", async () => {
    expect(await legIdFor("x", "y")).toBe(await legIdFor("x", "y"));
    expect(await legIdFor("x", "y")).not.toBe(await legIdFor("y", "x"));
  });
});
