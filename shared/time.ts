/** "HH:MM" → minutes after midnight. */
export function parseHhmm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes after midnight → "HH:MM"; values past midnight wrap (shown with a "+1" badge in the UI). */
export function formatHhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function dayOffset(minutes: number): number {
  return Math.floor(minutes / 1440);
}

/** 95 → "1 小時 35 分", 45 → "45 分", 120 → "2 小時". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} 分`;
  return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分`;
}

function offsetMs(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epoch));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(epoch / 1000) * 1000;
}

/** Wall-clock time in `timeZone` on `date` ("YYYY-MM-DD"), `minutes` after midnight → epoch ms. */
export function zonedToEpoch(date: string, minutes: number, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const naive = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1) + minutes * 60_000;
  const first = naive - offsetMs(naive, timeZone);
  // Re-check at the candidate instant: the offset differs across a DST change.
  const second = naive - offsetMs(first, timeZone);
  return second;
}

/** Inclusive list of "YYYY-MM-DD" dates. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [y, m, d] = start.split("-").map(Number);
  const cursor = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  for (let i = 0; i < 366; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    if (iso > end) break;
    out.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** "2027-03-26" → { md: "3/26", weekday: "五", full: "2027/3/26" }. */
export function describeDate(date: string): { md: string; weekday: string; full: string } {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? "";
  return { md: `${m}/${d}`, weekday, full: `${y}/${m}/${d}` };
}
