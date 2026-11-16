import type { Day, Trip } from "../../shared/schema";
import { describeDate } from "../../shared/time";
import { computeTimeline, type LegAlternative, type Timeline } from "../../shared/timeline";
import { stopsOfDay, type TripBundle } from "./queries";

export type TripGroup = "upcoming" | "draft" | "past";

export function tripGroup(trip: Trip, today: string): TripGroup {
  if (!trip.start_date || !trip.end_date) return "draft";
  return trip.end_date >= today ? "upcoming" : "past";
}

/** "2027/3/26（五）– 3/28（日）· 2 人" */
export function tripDateText(trip: Trip): string {
  const people = `${trip.party_size} 人`;
  if (!trip.start_date || !trip.end_date) return `日期未定 · ${people}`;
  const s = describeDate(trip.start_date);
  const e = describeDate(trip.end_date);
  const sameYear = trip.start_date.slice(0, 4) === trip.end_date.slice(0, 4);
  const end = sameYear ? e.md : e.full;
  if (trip.start_date === trip.end_date) return `${s.full}（${s.weekday}）· ${people}`;
  return `${s.full}（${s.weekday}）– ${end}（${e.weekday}）· ${people}`;
}

export function dayTimeline(bundle: TripBundle, day: Day, alternatives?: Map<string, LegAlternative[]>): Timeline {
  return computeTimeline({
    departTime: day.depart_time,
    stops: stopsOfDay(bundle, day.id),
    legs: bundle.legs,
    reservations: bundle.reservations,
    ...(alternatives ? { alternatives } : {}),
  });
}

export type TripSummary = {
  group: TripGroup;
  dateText: string;
  dayCount: number;
  stopCount: number;
  reservationCount: number;
  conflicts: { dayNumber: number; count: number }[];
};

export function summarizeTrip(bundle: TripBundle, today: string): TripSummary {
  const conflicts = bundle.days
    .map((day, i) => ({ dayNumber: i + 1, count: dayTimeline(bundle, day).conflictCount }))
    .filter((c) => c.count > 0);
  return {
    group: tripGroup(bundle.trip, today),
    dateText: tripDateText(bundle.trip),
    dayCount: bundle.days.length,
    stopCount: bundle.stops.length,
    reservationCount: bundle.reservations.length,
    conflicts,
  };
}

export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
