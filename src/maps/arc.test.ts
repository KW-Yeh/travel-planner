import { describe, expect, it } from "vitest";
import { arcPath } from "./arc";

const kyotoStation = { lat: 34.9858, lng: 135.7588 };
const inari = { lat: 34.9671, lng: 135.7727 };
const kiyomizu = { lat: 34.9949, lng: 135.785 };

describe("arcPath", () => {
  it("starts and ends exactly at the two places", () => {
    const path = arcPath(kyotoStation, kiyomizu);
    expect(path[0]).toEqual(kyotoStation);
    expect(path.at(-1)?.lat).toBeCloseTo(kiyomizu.lat, 10);
    expect(path.at(-1)?.lng).toBeCloseTo(kiyomizu.lng, 10);
  });

  it("bows north of the straight line whichever way the leg runs", () => {
    for (const [a, b] of [
      [kyotoStation, inari],
      [inari, kyotoStation],
      [inari, kiyomizu],
      [kiyomizu, inari],
    ] as const) {
      const mid = arcPath(a, b)[16];
      expect(mid?.lat).toBeGreaterThan((a.lat + b.lat) / 2);
    }
  });

  it("rises in proportion to the distance", () => {
    const short = arcPath(kyotoStation, { lat: kyotoStation.lat, lng: kyotoStation.lng + 0.01 })[16];
    const long = arcPath(kyotoStation, { lat: kyotoStation.lat, lng: kyotoStation.lng + 0.1 })[16];
    if (!short || !long) throw new Error("path too short");
    expect((long.lat - kyotoStation.lat) / (short.lat - kyotoStation.lat)).toBeCloseTo(10, 5);
  });

  it("falls back to a straight segment when both ends are the same place", () => {
    expect(arcPath(inari, inari)).toEqual([inari, inari]);
  });
});
