// Day timeline rules (PLAN §6). Pure: same input, same output; no clock, no IO.
import type { Leg, LegMode, Reservation, Stop } from "./schema";
import { parseHhmm, zonedToEpoch } from "./time";

export type LegAlternative = { mode: LegMode; minutes: number };

export type Suggestion =
  | { kind: "shorten_stay"; stopId: string; stayMinutes: number; byMinutes: number }
  | { kind: "switch_mode"; legId: string; mode: LegMode; savesMinutes: number };

export type Conflict =
  | { kind: "fixed_unreachable"; lateBy: number }
  | { kind: "late_for_reservation"; reservationId: string; lateBy: number; suggestions: Suggestion[] };

export type TimelineEntry = {
  stop: Stop;
  /** Leg arriving at this stop (undefined for the first stop). null = not created yet. */
  legIn?: Leg | null;
  /** Minutes after midnight; null when an earlier travel time is still unknown. */
  arrival: number | null;
  departure: number | null;
  waitMinutes: number;
  conflicts: Conflict[];
};

export type Timeline = { entries: TimelineEntry[]; travelMinutes: number; conflictCount: number };

export type TimelineInput = {
  departTime: string;
  /** Live stops of the day, already in display order. */
  stops: Stop[];
  legs: Leg[];
  reservations: Reservation[];
  alternatives?: Map<string, LegAlternative[]>;
};

export const SUGGEST_MIN_STAY = 30;
export const SUGGEST_STEP = 15;

export const pairKey = (from: string, to: string) => `${from}>${to}`;

export function liveLegsByPair(legs: Leg[]): Map<string, Leg> {
  const map = new Map<string, Leg>();
  for (const leg of legs) if (leg.deleted === 0) map.set(pairKey(leg.from_stop_id, leg.to_stop_id), leg);
  return map;
}

export function computeTimeline({ departTime, stops, legs, reservations, alternatives }: TimelineInput): Timeline {
  const legByPair = liveLegsByPair(legs);
  const reservationsByStop = new Map<string, Reservation[]>();
  for (const r of reservations) {
    if (r.deleted === 1 || r.time === null) continue;
    reservationsByStop.set(r.stop_id, [...(reservationsByStop.get(r.stop_id) ?? []), r]);
  }

  const entries: TimelineEntry[] = [];
  let travelMinutes = 0;
  let conflictCount = 0;
  // Index of the latest fixed stop: stays before it cannot move anything after it.
  let anchor = 0;

  stops.forEach((stop, i) => {
    const conflicts: Conflict[] = [];
    const floor = anchor;
    if (i === 0) {
      const start = parseHhmm(departTime);
      entries.push({ stop, arrival: start, departure: start, waitMinutes: 0, conflicts });
      checkReservations(stop, start, i, floor);
      return;
    }

    const prev = entries[i - 1];
    const prevStop = stops[i - 1];
    if (!prev || !prevStop) return;
    const legIn = legByPair.get(pairKey(prevStop.id, stop.id)) ?? null;
    if (legIn?.minutes != null) travelMinutes += legIn.minutes;

    const expected = prev.departure !== null && legIn?.minutes != null ? prev.departure + legIn.minutes : null;
    let arrival = expected;
    let waitMinutes = 0;
    let actualArrival = expected;

    if (stop.arrival_mode === "fixed" && stop.fixed_time !== null) {
      const fixed = parseHhmm(stop.fixed_time);
      arrival = fixed;
      anchor = i;
      if (expected !== null && expected > fixed) {
        conflicts.push({ kind: "fixed_unreachable", lateBy: expected - fixed });
      } else {
        actualArrival = fixed;
        if (expected !== null) waitMinutes = fixed - expected;
      }
    }

    const departure = arrival === null ? null : arrival + stop.stay_minutes;
    const entry: TimelineEntry = { stop, legIn, arrival, departure, waitMinutes, conflicts };
    entries.push(entry);
    checkReservations(stop, actualArrival ?? arrival, i, floor);
  });

  function checkReservations(stop: Stop, arrival: number | null, index: number, floor: number) {
    const entry = entries[index];
    if (!entry || arrival === null) return;
    for (const r of reservationsByStop.get(stop.id) ?? []) {
      const lateBy = arrival - parseHhmm(r.time ?? "00:00");
      if (lateBy <= 0) continue;
      entry.conflicts.push({ kind: "late_for_reservation", reservationId: r.id, lateBy, suggestions: suggest(index, lateBy, floor) });
    }
  }

  function suggest(index: number, lateBy: number, floor: number): Suggestion[] {
    const out: Suggestion[] = [];
    const cut = Math.ceil(lateBy / SUGGEST_STEP) * SUGGEST_STEP;
    for (let j = index - 1; j >= Math.max(floor, 1); j--) {
      const s = stops[j];
      if (s && s.stay_minutes >= SUGGEST_MIN_STAY && s.stay_minutes - cut >= SUGGEST_STEP) {
        out.push({ kind: "shorten_stay", stopId: s.id, stayMinutes: s.stay_minutes - cut, byMinutes: cut });
        break;
      }
    }
    const legIn = entries[index]?.legIn;
    const current = legIn?.minutes;
    if (legIn && current != null) {
      const faster = (alternatives?.get(legIn.id) ?? [])
        .filter((alt) => alt.mode !== legIn.mode && current - alt.minutes >= lateBy)
        .sort((a, b) => a.minutes - b.minutes)[0];
      if (faster) out.push({ kind: "switch_mode", legId: legIn.id, mode: faster.mode, savesMinutes: current - faster.minutes });
    }
    return out;
  }

  for (const e of entries) conflictCount += e.conflicts.length;
  return { entries, travelMinutes, conflictCount };
}

export type LegRefresh = { fromStopId: string; toStopId: string; leg: Leg | null; departAt: number | null; reason: "missing" | "unknown" | "departure_moved" };

export const TRANSIT_REQUERY_MS = 30 * 60_000;

/**
 * Legs that need a (re)query after the day changed: consecutive pairs without a leg, Google
 * legs still without a time, and transit legs whose planned departure drifted more than 30 min
 * from the time they were queried for. Manual legs are never re-queried, and driving, walking
 * and cycling (no live traffic) do not depend on the departure time.
 */
export function legsToRefresh(timeline: Timeline, date: string | null, timeZone: string): LegRefresh[] {
  const out: LegRefresh[] = [];
  timeline.entries.forEach((entry, i) => {
    if (i === 0) return;
    const prev = timeline.entries[i - 1];
    if (!prev) return;
    const departAt = date !== null && prev.departure !== null ? zonedToEpoch(date, prev.departure, timeZone) : null;
    const base = { fromStopId: prev.stop.id, toStopId: entry.stop.id, departAt };
    const leg = entry.legIn ?? null;
    if (!leg) {
      out.push({ ...base, leg: null, reason: "missing" });
      return;
    }
    if (leg.source === "manual") return;
    if (leg.minutes === null) {
      out.push({ ...base, leg, reason: "unknown" });
      return;
    }
    if (
      leg.mode === "transit" &&
      departAt !== null &&
      leg.query_depart_at !== null &&
      Math.abs(departAt - leg.query_depart_at) > TRANSIT_REQUERY_MS
    ) {
      out.push({ ...base, leg, reason: "departure_moved" });
    }
  });
  return out;
}
