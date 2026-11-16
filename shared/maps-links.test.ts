import { describe, expect, it } from "vitest";
import { directionsUrl, parseShareUrl } from "./maps-links";

describe("directionsUrl", () => {
  it("links one leg with place IDs and the chosen mode", () => {
    const url = new URL(
      directionsUrl(
        { name: "伏見稻荷大社", placeId: "P1", lat: 34.96, lng: 135.77 },
        { name: "清水寺", placeId: "P2", lat: 34.99, lng: 135.78 },
        "transit",
      ),
    );
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: "1",
      origin: "伏見稻荷大社",
      destination: "清水寺",
      travelmode: "transit",
      origin_place_id: "P1",
      destination_place_id: "P2",
    });
  });

  it("uses coordinates when there is no place ID, and the right mode names", () => {
    const url = new URL(
      directionsUrl({ name: "自訂", placeId: null, lat: 35.1, lng: 135.2 }, { name: "B", placeId: null, lat: null, lng: null }, "walk"),
    );
    expect(url.searchParams.get("origin")).toBe("35.1,135.2");
    expect(url.searchParams.get("destination")).toBe("B");
    expect(url.searchParams.get("travelmode")).toBe("walking");
  });
});

describe("parseShareUrl", () => {
  it("reads a place URL with pin coordinates", () => {
    expect(
      parseShareUrl("https://www.google.com/maps/place/%E6%B8%85%E6%B0%B4%E5%AF%BA/@34.9948,135.7829,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d34.994856!4d135.785046"),
    ).toEqual({ name: "清水寺", placeId: null, lat: 34.994856, lng: 135.785046 });
  });

  it("reads search URLs with coordinates or a place ID", () => {
    expect(parseShareUrl("https://maps.google.com/?q=35.0116,135.7681")).toEqual({ name: null, placeId: null, lat: 35.0116, lng: 135.7681 });
    expect(parseShareUrl("https://www.google.com/maps/search/?api=1&query=Nishiki+Market&query_place_id=ChIJabc")).toEqual({
      name: "Nishiki Market",
      placeId: "ChIJabc",
      lat: null,
      lng: null,
    });
  });

  it("rejects other sites and unusable links", () => {
    expect(parseShareUrl("https://evil.example/maps/place/x/@1,2")).toBeNull();
    expect(parseShareUrl("not a url")).toBeNull();
    expect(parseShareUrl("https://www.google.com/maps")).toBeNull();
  });
});
