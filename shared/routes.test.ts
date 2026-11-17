import { describe, expect, it } from "vitest";
import { isWalkOnly, shownMode, type RouteStep } from "./routes";

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
