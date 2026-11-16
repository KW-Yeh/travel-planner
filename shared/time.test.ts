import { describe, expect, it } from "vitest";
import { byPosition, keyBetween } from "./position";
import { dateRange, describeDate, formatDuration, formatHhmm, parseHhmm, zonedToEpoch } from "./time";

describe("time helpers", () => {
  it("parses and formats HH:MM, wrapping past midnight", () => {
    expect(parseHhmm("13:57")).toBe(837);
    expect(formatHhmm(837)).toBe("13:57");
    expect(formatHhmm(1440 + 75)).toBe("01:15");
  });

  it.each([
    [45, "45 分"],
    [60, "1 小時"],
    [100, "1 小時 40 分"],
    [65, "1 小時 5 分"],
  ])("formatDuration(%i) = %s", (m, text) => {
    expect(formatDuration(m)).toBe(text);
  });

  it("converts trip-local wall time to an instant, across DST changes", () => {
    expect(zonedToEpoch("2027-03-26", 9 * 60 + 12, "Asia/Tokyo")).toBe(Date.UTC(2027, 2, 26, 0, 12));
    expect(zonedToEpoch("2027-03-13", 12 * 60, "America/New_York")).toBe(Date.UTC(2027, 2, 13, 17, 0));
    expect(zonedToEpoch("2027-03-15", 12 * 60, "America/New_York")).toBe(Date.UTC(2027, 2, 15, 16, 0));
    expect(zonedToEpoch("2027-03-26", 0, "Asia/Taipei")).toBe(Date.UTC(2027, 2, 25, 16, 0));
  });

  it("lists dates inclusively across month ends", () => {
    expect(dateRange("2027-02-27", "2027-03-02")).toEqual(["2027-02-27", "2027-02-28", "2027-03-01", "2027-03-02"]);
    expect(dateRange("2027-03-02", "2027-03-01")).toEqual([]);
  });

  it("describes a date with its weekday", () => {
    expect(describeDate("2027-03-26")).toEqual({ md: "3/26", weekday: "五", full: "2027/3/26" });
  });
});

describe("keyBetween", () => {
  it("keeps order under repeated inserts at the front, back and middle", () => {
    const keys: string[] = [keyBetween(null, null)];
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(rand() * (keys.length + 1));
      const k = keyBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, k);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThan(40);
  });

  it("rejects out-of-order bounds", () => {
    expect(() => keyBetween("m", "a")).toThrow();
  });

  it("breaks position ties by id", () => {
    const rows = [
      { position: "m", id: "b" },
      { position: "m", id: "a" },
      { position: "c", id: "z" },
    ];
    expect(rows.sort(byPosition).map((r) => r.id)).toEqual(["z", "a", "b"]);
  });
});
