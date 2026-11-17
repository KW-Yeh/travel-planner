import { describe, expect, it } from "vitest";
import { decodePath, encodePath, parseTrack, serializeTrack } from "./track";

describe("encoded polylines", () => {
  // Google's reference example for the encoded polyline algorithm.
  const points: [number, number][] = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ];
  const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

  it("encodes and decodes the reference path", () => {
    expect(encodePath(points)).toBe(encoded);
    expect(decodePath(encoded)).toEqual(points);
  });
});

describe("tracks", () => {
  it("does not treat a plain Google polyline as a track", () => {
    expect(parseTrack("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toBeNull();
    expect(parseTrack("{not json")).toBeNull();
  });

  it("round-trips segments", () => {
    const json = serializeTrack(
      [
        { color: null, walk: true, points: [[35.68, 139.76], [35.681, 139.761]] },
        { color: "#F15A22", walk: false, points: [[35.681, 139.761], [35.69, 139.7]] },
      ],
      10_000,
    );
    const segs = parseTrack(json);
    expect(segs).toHaveLength(2);
    expect(segs?.[1]).toMatchObject({ color: "#F15A22", walk: false });
    expect(decodePath(segs?.[1]?.path ?? "")).toEqual([[35.681, 139.761], [35.69, 139.7]]);
  });

  it("thins long tracks until they fit, keeping both ends", () => {
    const round = (n: number) => Math.round(n * 1e5) / 1e5;
    const points: [number, number][] = Array.from({ length: 20_000 }, (_, i) => [round(34 + i * 0.0001), round(135 + Math.sin(i) * 0.01)]);
    const json = serializeTrack([{ color: "#0072BC", walk: false, points }], 5_000);
    expect(json.length).toBeLessThanOrEqual(5_000);
    const path = decodePath(parseTrack(json)?.[0]?.path ?? "");
    expect(path[0]).toEqual(points[0]);
    expect(path.at(-1)).toEqual(points.at(-1));
  });
});
