import { describe, expect, it } from "vitest";
import { isWalkOnly, keepsLookup, shownMode, type RouteResult, type RouteStep } from "./routes";

const ride: RouteStep = {
  kind: "transit",
  minutes: 15,
  line: "ＪＲ中央線快速",
  vehicle: null,
  headsign: null,
  stops: null,
  from: "東京",
  to: "新宿",
  departAt: null,
};

describe("walk-only transit results", () => {
  it("spots a transit result with no ride in it", () => {
    expect(isWalkOnly([{ kind: "walk", minutes: 12 }])).toBe(true);
    expect(isWalkOnly([{ kind: "walk", minutes: 5 }, ride])).toBe(false);
    // Nothing looked up yet is not "walk only".
    expect(isWalkOnly([])).toBe(false);
  });

  it("shows such a leg as walking", () => {
    expect(shownMode({ mode: "transit", steps: JSON.stringify([{ kind: "walk", minutes: 12 }]) })).toBe("walk");
    expect(shownMode({ mode: "transit", steps: JSON.stringify([ride]) })).toBe("transit");
    expect(shownMode({ mode: "transit", steps: null })).toBe("transit");
    expect(shownMode({ mode: "transit", steps: "not json" })).toBe("transit");
    expect(shownMode({ mode: "drive", steps: JSON.stringify([{ kind: "walk", minutes: 1 }]) })).toBe("drive");
  });
});

describe("keepsLookup (automatic re-lookups)", () => {
  const ok: RouteResult = { status: "ok", minutes: 84, distanceMeters: 50_000, polyline: null, steps: [ride] };

  it("never replaces a saved route with an empty answer", () => {
    // A client on an old version asks Google for Japan transit and gets no_route: the saved route must survive.
    expect(keepsLookup({ minutes: 84 }, { status: "no_route" })).toBe(false);
    expect(keepsLookup({ minutes: 84 }, { status: "out_of_range" })).toBe(false);
  });

  it("stores a real route, and records a failed attempt only where nothing was saved", () => {
    expect(keepsLookup({ minutes: 84 }, ok)).toBe(true);
    expect(keepsLookup({ minutes: null }, ok)).toBe(true);
    expect(keepsLookup({ minutes: null }, { status: "no_route" })).toBe(true);
  });
});
