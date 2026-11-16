import { describe, expect, it } from "vitest";
import type { Trip } from "../../shared/schema";
import { tripDateText, tripGroup } from "./summary";

const trip = (start: string | null, end: string | null): Trip => ({
  id: "00000000-0000-4000-8000-000000000001",
  updated_at: 1,
  deleted: 0,
  name: "x",
  start_date: start,
  end_date: end,
  party_size: 2,
  time_zone: "Asia/Tokyo",
});

describe("trip summary", () => {
  it("formats the date range like the design", () => {
    expect(tripDateText(trip("2027-03-26", "2027-03-28"))).toBe("2027/3/26（五）– 3/28（日）· 2 人");
    expect(tripDateText(trip("2026-12-30", "2027-01-02"))).toBe("2026/12/30（三）– 2027/1/2（六）· 2 人");
    expect(tripDateText(trip("2027-03-26", "2027-03-26"))).toBe("2027/3/26（五）· 2 人");
    expect(tripDateText(trip(null, null))).toBe("日期未定 · 2 人");
  });

  it("groups trips into upcoming, draft and past", () => {
    expect(tripGroup(trip("2027-03-26", "2027-03-28"), "2027-03-28")).toBe("upcoming");
    expect(tripGroup(trip("2027-03-26", "2027-03-28"), "2027-03-29")).toBe("past");
    expect(tripGroup(trip(null, null), "2027-03-29")).toBe("draft");
  });
});
