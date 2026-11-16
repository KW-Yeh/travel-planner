import { describe, expect, it } from "vitest";
import type { Leg, Reservation, Stop } from "./schema";
import { computeTimeline, legsToRefresh, type TimelineInput } from "./timeline";
import { zonedToEpoch } from "./time";

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const TRIP = uid();

function stop(name: string, stay: number, extra: Partial<Stop> = {}): Stop {
  return {
    id: uid(),
    updated_at: 1,
    deleted: 0,
    trip_id: TRIP,
    day_id: null,
    position: "a",
    place_id: null,
    name,
    address: null,
    lat: null,
    lng: null,
    place_fetched_at: null,
    kind: "sight",
    arrival_mode: "auto",
    fixed_time: null,
    stay_minutes: stay,
    note: null,
    ...extra,
  };
}

function leg(from: Stop, to: Stop, minutes: number | null, extra: Partial<Leg> = {}): Leg {
  return {
    id: uid(),
    updated_at: 1,
    deleted: 0,
    trip_id: TRIP,
    from_stop_id: from.id,
    to_stop_id: to.id,
    mode: "transit",
    minutes,
    steps: null,
    polyline: null,
    source: "google",
    fetched_at: null,
    query_depart_at: null,
    ...extra,
  };
}

function reservation(s: Stop, time: string | null): Reservation {
  return {
    id: uid(),
    updated_at: 1,
    deleted: 0,
    trip_id: TRIP,
    stop_id: s.id,
    time,
    party_size: 2,
    code: null,
    url: null,
    status: "confirmed",
  };
}

/** The design artifact's Day 1: Kyoto Station → Fushimi Inari → Kiyomizu-dera → Nishiki lunch (booked 13:30). */
function kyotoDay() {
  const station = stop("京都車站", 0);
  const inari = stop("伏見稻荷大社", 100);
  const kiyomizu = stop("清水寺", 120);
  const nishiki = stop("錦市場", 60, { kind: "food" });
  const legs = [leg(station, inari, 8), leg(inari, kiyomizu, 32), leg(kiyomizu, nishiki, 25)];
  const input: TimelineInput = {
    departTime: "09:12",
    stops: [station, inari, kiyomizu, nishiki],
    legs,
    reservations: [reservation(nishiki, "13:30")],
  };
  return { station, inari, kiyomizu, nishiki, legs, input };
}

const hhmm = (m: number | null) =>
  m === null ? null : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

describe("computeTimeline", () => {
  it("reproduces the design's Day 1 times, travel total and lunch conflict", () => {
    const { input, kiyomizu } = kyotoDay();
    const t = computeTimeline(input);
    expect(t.entries.map((e) => [hhmm(e.arrival), hhmm(e.departure)])).toEqual([
      ["09:12", "09:12"],
      ["09:20", "11:00"],
      ["11:32", "13:32"],
      ["13:57", "14:57"],
    ]);
    expect(t.travelMinutes).toBe(65);
    expect(t.conflictCount).toBe(1);
    expect(t.entries[3]?.conflicts).toEqual([
      {
        kind: "late_for_reservation",
        reservationId: input.reservations[0]?.id,
        lateBy: 27,
        suggestions: [{ kind: "shorten_stay", stopId: kiyomizu.id, stayMinutes: 90, byMinutes: 30 }],
      },
    ]);
  });

  it("pushes every later stop when a stay grows", () => {
    const { input, inari } = kyotoDay();
    const longer = { ...input, stops: input.stops.map((s) => (s.id === inari.id ? { ...s, stay_minutes: 130 } : s)) };
    const t = computeTimeline(longer);
    expect(t.entries.map((e) => hhmm(e.arrival))).toEqual(["09:12", "09:20", "12:02", "14:27"]);
  });

  it("starts the day at the day's departure time and ignores the first stop's stay", () => {
    const a = stop("hotel", 600);
    const b = stop("b", 30);
    const t = computeTimeline({ departTime: "08:00", stops: [a, b], legs: [leg(a, b, 10)], reservations: [] });
    expect(t.entries.map((e) => hhmm(e.arrival))).toEqual(["08:00", "08:10"]);
  });

  it("does not push a fixed-time stop; earlier arrival becomes waiting time", () => {
    const a = stop("a", 0);
    const show = stop("show", 60, { arrival_mode: "fixed", fixed_time: "10:00" });
    const c = stop("c", 30);
    const t = computeTimeline({
      departTime: "09:00",
      stops: [a, show, c],
      legs: [leg(a, show, 20), leg(show, c, 10)],
      reservations: [],
    });
    expect(t.entries[1]).toMatchObject({ arrival: 600, departure: 660, waitMinutes: 40, conflicts: [] });
    expect(hhmm(t.entries[2]?.arrival ?? null)).toBe("11:10");
  });

  it("flags a fixed-time stop that cannot be reached, without moving it", () => {
    const a = stop("a", 0);
    const show = stop("show", 60, { arrival_mode: "fixed", fixed_time: "09:10" });
    const c = stop("c", 0);
    const t = computeTimeline({
      departTime: "09:00",
      stops: [a, show, c],
      legs: [leg(a, show, 25), leg(show, c, 5)],
      reservations: [],
    });
    expect(t.entries[1]).toMatchObject({ arrival: 550, conflicts: [{ kind: "fixed_unreachable", lateBy: 15 }] });
    expect(hhmm(t.entries[2]?.arrival ?? null)).toBe("10:15");
  });

  it("leaves times unknown after a leg without minutes, until a fixed stop", () => {
    const a = stop("a", 0);
    const b = stop("b", 30);
    const c = stop("c", 30);
    const fixed = stop("fixed", 30, { arrival_mode: "fixed", fixed_time: "15:00" });
    const late = reservation(c, "09:00");
    const t = computeTimeline({
      departTime: "09:00",
      stops: [a, b, c, fixed],
      legs: [leg(a, b, null), leg(b, c, 10), leg(c, fixed, 10)],
      reservations: [late],
    });
    expect(t.entries.map((e) => e.arrival)).toEqual([540, null, null, 900]);
    expect(t.entries[3]?.waitMinutes).toBe(0);
    expect(t.conflictCount).toBe(0);
  });

  it("treats a missing leg like an unknown travel time", () => {
    const a = stop("a", 0);
    const b = stop("b", 30);
    const t = computeTimeline({ departTime: "09:00", stops: [a, b], legs: [], reservations: [] });
    expect(t.entries[1]).toMatchObject({ legIn: null, arrival: null });
  });

  it("ignores deleted legs and reservations, and reservations without a time", () => {
    const { input, nishiki } = kyotoDay();
    const deletedRes = { ...reservation(nishiki, "10:00"), deleted: 1 as const };
    const t = computeTimeline({ ...input, reservations: [deletedRes, reservation(nishiki, null)] });
    expect(t.conflictCount).toBe(0);
  });

  it("allows times past midnight", () => {
    const a = stop("a", 0);
    const b = stop("b", 120);
    const c = stop("c", 0);
    const t = computeTimeline({ departTime: "23:00", stops: [a, b, c], legs: [leg(a, b, 30), leg(b, c, 30)], reservations: [] });
    expect(t.entries[2]?.arrival).toBe(23 * 60 + 30 + 120 + 30);
  });

  it("does not suggest shortening a stay before an earlier fixed stop", () => {
    const a = stop("a", 0);
    const long = stop("long", 180);
    const fixed = stop("fixed", 10, { arrival_mode: "fixed", fixed_time: "13:00" });
    const lunch = stop("lunch", 60);
    const t = computeTimeline({
      departTime: "09:00",
      stops: [a, long, fixed, lunch],
      legs: [leg(a, long, 10), leg(long, fixed, 10), leg(fixed, lunch, 30)],
      reservations: [reservation(lunch, "13:20")],
    });
    const conflict = t.entries[3]?.conflicts[0];
    expect(conflict).toMatchObject({ kind: "late_for_reservation", lateBy: 20 });
    expect(conflict?.kind === "late_for_reservation" && conflict.suggestions).toEqual([]);
  });

  it("suggests shortening stays before a late fixed stop that has the reservation", () => {
    const a = stop("a", 0);
    const long = stop("long", 180);
    const show = stop("show", 60, { arrival_mode: "fixed", fixed_time: "12:00" });
    const t = computeTimeline({
      departTime: "09:00",
      stops: [a, long, show],
      legs: [leg(a, long, 10), leg(long, show, 10)],
      reservations: [reservation(show, "12:00")],
    });
    const late = t.entries[2]?.conflicts.find((c) => c.kind === "late_for_reservation");
    expect(late).toMatchObject({ lateBy: 20, suggestions: [{ kind: "shorten_stay", stopId: long.id, stayMinutes: 150 }] });
  });

  it("skips stays too short to shorten and suggests a faster cached mode", () => {
    const a = stop("a", 0);
    const quick = stop("quick", 20);
    const dinner = stop("dinner", 60);
    const slow = leg(quick, dinner, 40);
    const t = computeTimeline({
      departTime: "18:00",
      stops: [a, quick, dinner],
      legs: [leg(a, quick, 10), slow],
      reservations: [reservation(dinner, "19:00")],
      alternatives: new Map([[slow.id, [{ mode: "drive", minutes: 15 }, { mode: "walk", minutes: 70 }]]]),
    });
    const late = t.entries[2]?.conflicts[0];
    expect(late).toMatchObject({
      lateBy: 10,
      suggestions: [{ kind: "switch_mode", legId: slow.id, mode: "drive", savesMinutes: 25 }],
    });
  });
});

describe("legsToRefresh", () => {
  const TZ = "Asia/Tokyo";
  const DATE = "2027-03-26";
  const NOW = Date.UTC(2027, 2, 1);

  it("retries a Google leg without a time at most once a day", () => {
    const a = stop("a", 0);
    const b = stop("b", 0);
    const tried = (at: number) =>
      computeTimeline({ departTime: "09:00", stops: [a, b], legs: [leg(a, b, null, { fetched_at: at })], reservations: [] });
    expect(legsToRefresh(tried(NOW - 3_600_000), DATE, TZ, NOW)).toEqual([]);
    expect(legsToRefresh(tried(NOW - 25 * 3_600_000), DATE, TZ, NOW).map((r) => r.reason)).toEqual(["unknown"]);
  });

  it("requests legs for new pairs and Google legs without a time, never manual ones", () => {
    const a = stop("a", 0);
    const b = stop("b", 30);
    const c = stop("c", 30);
    const d = stop("d", 30);
    const t = computeTimeline({
      departTime: "09:00",
      stops: [a, b, c, d],
      legs: [leg(b, c, null), leg(c, d, null, { source: "manual" })],
      reservations: [],
    });
    expect(legsToRefresh(t, DATE, TZ, NOW).map((r) => [r.fromStopId, r.toStopId, r.reason])).toEqual([
      [a.id, b.id, "missing"],
      [b.id, c.id, "unknown"],
    ]);
  });

  it("re-queries only transit legs whose departure moved more than 30 minutes", () => {
    const { input, legs } = kyotoDay();
    const queriedAt = (m: number) => zonedToEpoch(DATE, m, TZ);
    const [first, second, third] = legs;
    if (!first || !second || !third) throw new Error("fixture");
    const stamped = [
      { ...first, query_depart_at: queriedAt(9 * 60 + 12) },
      { ...second, query_depart_at: queriedAt(10 * 60 + 15) },
      { ...third, mode: "drive" as const, query_depart_at: queriedAt(8 * 60) },
    ];
    const t = computeTimeline({ ...input, legs: stamped });
    expect(legsToRefresh(t, DATE, TZ, NOW).map((r) => [r.leg?.id, r.reason])).toEqual([[second.id, "departure_moved"]]);
  });

  it("gives the planned departure as an instant in the trip's time zone", () => {
    const a = stop("a", 0);
    const b = stop("b", 0);
    const t = computeTimeline({ departTime: "09:12", stops: [a, b], legs: [], reservations: [] });
    expect(legsToRefresh(t, DATE, TZ, NOW)[0]?.departAt).toBe(Date.UTC(2027, 2, 26, 0, 12));
    expect(legsToRefresh(t, null, TZ, NOW)[0]?.departAt).toBeNull();
  });
});
