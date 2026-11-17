import { describe, expect, it } from "vitest";
import type { Stop } from "../../shared/schema";
import { matchPlaces, tripPlaces } from "./tripPlaces";

let n = 0;
function stop(over: Partial<Stop>): Stop {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    updated_at: n,
    deleted: 0,
    trip_id: "00000000-0000-4000-8000-000000000000",
    day_id: null,
    position: "a",
    place_id: null,
    name: "地點",
    address: null,
    lat: null,
    lng: null,
    place_fetched_at: null,
    kind: "sight",
    arrival_mode: "auto",
    fixed_time: null,
    stay_minutes: 60,
    note: null,
    ...over,
  };
}

describe("tripPlaces", () => {
  it("lists located places once each, most recently changed first, without the stop being edited", () => {
    const hotelDay1 = stop({ name: "京都飯店", place_id: "P-hotel", lat: 35, lng: 135.7, kind: "lodging", updated_at: 10, place_fetched_at: 5 });
    const hotelDay2 = stop({ name: "京都飯店", place_id: "P-hotel", lat: 35, lng: 135.7, kind: "lodging", updated_at: 30, place_fetched_at: 7 });
    const temple = stop({ name: "清水寺", place_id: "P-kiyo", lat: 34.99, lng: 135.78, updated_at: 20 });
    const pinOnly = stop({ name: "路邊小店", lat: 35.01, lng: 135.76, updated_at: 15 });
    const noPlace = stop({ name: "自由活動", updated_at: 40 });
    const editing = stop({ name: "伏見稻荷", place_id: "P-inari", lat: 34.97, lng: 135.77, updated_at: 50 });

    const list = tripPlaces([hotelDay1, hotelDay2, temple, pinOnly, noPlace, editing], editing.id);
    expect(list.map((p) => p.name)).toEqual(["京都飯店", "清水寺", "路邊小店"]);
    expect(list[0]).toMatchObject({ placeId: "P-hotel", kind: "lodging", fetchedAt: 7, lat: 35, lng: 135.7 });
  });

  it("treats the same pin with the same name as one place", () => {
    const a = stop({ name: "集合點", lat: 35.000001, lng: 135.000001 });
    const b = stop({ name: "集合點", lat: 35.000002, lng: 135.000002 });
    expect(tripPlaces([a, b], null)).toHaveLength(1);
  });
});

describe("matchPlaces", () => {
  const places = tripPlaces(
    [
      stop({ name: "ＪＲ京都駅", address: "京都市下京区", place_id: "P-a", lat: 1, lng: 1 }),
      stop({ name: "Kyoto Tower", address: "Karasuma-dori", place_id: "P-b", lat: 2, lng: 2 }),
    ],
    null,
  );

  it("matches name or address, ignoring case and full-width letters", () => {
    expect(matchPlaces(places, "jr").map((p) => p.placeId)).toEqual(["P-a"]);
    expect(matchPlaces(places, "kyoto").map((p) => p.placeId)).toEqual(["P-b"]);
    expect(matchPlaces(places, "下京").map((p) => p.placeId)).toEqual(["P-a"]);
    expect(matchPlaces(places, "  ")).toEqual([]);
  });
});
