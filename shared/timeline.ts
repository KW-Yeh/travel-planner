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

/** A lodging first stop is where the day starts from, so the day's departure time is when you leave it. */
export function isDayOrigin(stop: Stop, index: number): boolean {
  return index === 0 && stop.kind === "lodging";
}

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
      const departure = isDayOrigin(stop, i) ? start : start + stop.stay_minutes;
      entries.push({ stop, arrival: start, departure, waitMinutes: 0, conflicts });
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
    for (let j = index - 1; j >= floor; j--) {
      const s = stops[j];
      if (s && !isDayOrigin(s, j) && s.stay_minutes >= SUGGEST_MIN_STAY && s.stay_minutes - cut >= SUGGEST_STEP) {
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

export type LegRefresh = { fromStopId: string; toStopId: string; leg: Leg | null; departAt: number | null; reason: "missing" | "unknown" };

/** A transit leg queried for a departure more than this far from the planned one shows its trains as outdated. */
export const TRANSIT_STALE_MS = 30 * 60_000;
/** A Google leg that came back without a time (no route, too far ahead) is retried at most daily. */
export const UNKNOWN_RETRY_MS = 24 * 3_600_000;

function plannedDeparture(prev: TimelineEntry, date: string | null, timeZone: string): number | null {
  return date !== null && prev.departure !== null ? zonedToEpoch(date, prev.departure, timeZone) : null;
}

/**
 * Legs that need a lookup after the day changed: consecutive pairs without a leg and Google legs
 * still without a time. A saved route is never re-queried automatically (each lookup is billed and
 * travel times barely move with the hour); a drifted transit departure is only flagged, see
 * `staleTransitLegs`. Manual legs are never re-queried.
 */
export function legsToRefresh(timeline: Timeline, date: string | null, timeZone: string, now: number): LegRefresh[] {
  const out: LegRefresh[] = [];
  timeline.entries.forEach((entry, i) => {
    if (i === 0) return;
    const prev = timeline.entries[i - 1];
    if (!prev) return;
    const base = { fromStopId: prev.stop.id, toStopId: entry.stop.id, departAt: plannedDeparture(prev, date, timeZone) };
    const leg = entry.legIn ?? null;
    if (!leg) {
      out.push({ ...base, leg: null, reason: "missing" });
      return;
    }
    if (leg.source === "manual") return;
    if (leg.minutes === null && (leg.fetched_at === null || now - leg.fetched_at > UNKNOWN_RETRY_MS)) {
      out.push({ ...base, leg, reason: "unknown" });
    }
  });
  return out;
}

/**
 * Transit legs whose saved route was looked up for a departure more than 30 min from the planned
 * one, so its train times no longer match. Maps leg id → the departure (epoch ms) it was queried for.
 */
export function staleTransitLegs(timeline: Timeline, date: string | null, timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  timeline.entries.forEach((entry, i) => {
    const prev = timeline.entries[i - 1];
    const leg = entry.legIn;
    if (i === 0 || !prev || !leg || leg.source !== "google" || leg.mode !== "transit" || leg.minutes === null) return;
    const departAt = plannedDeparture(prev, date, timeZone);
    if (departAt !== null && leg.query_depart_at !== null && Math.abs(departAt - leg.query_depart_at) > TRANSIT_STALE_MS) {
      out.set(leg.id, leg.query_depart_at);
    }
  });
  return out;
}
