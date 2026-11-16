import { describe, expect, it } from "vitest";
import { PLACE_COORDS_MAX_AGE_MS, PLACE_REFRESH_AGE_MS, isStale } from "./places";

const NOW = Date.UTC(2027, 2, 1);

describe("isStale", () => {
  it("refreshes coordinates never fetched or close to the 30-day limit", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(NOW, NOW)).toBe(false);
    expect(isStale(NOW - PLACE_REFRESH_AGE_MS, NOW)).toBe(false);
    expect(isStale(NOW - PLACE_REFRESH_AGE_MS - 1, NOW)).toBe(true);
    expect(PLACE_REFRESH_AGE_MS).toBeLessThan(PLACE_COORDS_MAX_AGE_MS);
  });
});
