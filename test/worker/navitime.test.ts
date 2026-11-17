import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompareRequest } from "../../shared/routes";
import { decodePath, parseTrack } from "../../shared/track";
import { fetchNavitime, inJapan, navitimeQueryTime, normalizeNavitime } from "../../worker/routes/navitime";
import fixture from "../fixtures/navitime-tokyo-shinjuku.json";

// Tuesday 2026-11-17 12:00 JST.
const NOW = Date.UTC(2026, 10, 17, 3, 0);
const REQ: CompareRequest = {
  origin: { lat: 35.681236, lng: 139.767125 },
  destination: { lat: 35.689592, lng: 139.700413 },
  departAt: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeNavitime", () => {
  it("turns a Tokyo → Shinjuku response into steps that add up, with a coloured track", () => {
    const r = normalizeNavitime(fixture);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.provider).toBe("navitime");
    expect(r.minutes).toBe(26);
    expect(r.steps).toEqual([
      { kind: "walk", minutes: 5 },
      { kind: "other", mode: "WAIT", minutes: 2 },
      {
        kind: "transit",
        minutes: 15,
        line: "ＪＲ中央線快速",
        vehicle: null,
        headsign: "新宿",
        stops: null,
        from: "東京",
        to: "新宿",
        departAt: null,
        color: "#F15A22",
        exit: "南口",
      },
      { kind: "walk", minutes: 4 },
    ]);
    expect(r.steps.reduce((s, x) => s + x.minutes, 0)).toBe(r.minutes);

    const segs = parseTrack(r.polyline ?? "");
    expect(segs?.map((s) => [s.walk, s.color])).toEqual([
      [true, null],
      [false, "#F15A22"],
      [true, null],
    ]);
    expect(decodePath(segs?.[1]?.path ?? "").length).toBeGreaterThan(50);
  });

  it("reports no route for an empty response", () => {
    expect(normalizeNavitime({ items: [] })).toEqual({ status: "no_route" });
    expect(normalizeNavitime(null)).toEqual({ status: "no_route" });
  });
});

describe("navitimeQueryTime", () => {
  it("uses tomorrow 09:00 JST without a departure", () => {
    expect(navitimeQueryTime(null, NOW)).toBe("2026-11-18T09:00:00");
  });

  it("keeps the departure's weekday and clock time, from tomorrow on", () => {
    // Friday 2026-11-27 22:30 JST → the next Friday from tomorrow.
    expect(navitimeQueryTime(Date.UTC(2026, 10, 27, 13, 30), NOW)).toBe("2026-11-20T22:30:00");
    // A Wednesday departure maps to tomorrow itself.
    expect(navitimeQueryTime(Date.UTC(2027, 0, 6, 0, 15), NOW)).toBe("2026-11-18T09:15:00");
  });
});

describe("inJapan", () => {
  it("needs coordinates inside Japan", () => {
    expect(inJapan({ lat: 35.68, lng: 139.76 })).toBe(true);
    expect(inJapan({ lat: 25.03, lng: 121.56 })).toBe(false);
    expect(inJapan({ placeId: "ChIJ-only" })).toBe(false);
  });
});

describe("fetchNavitime", () => {
  it("calls RapidAPI with the key in headers and the track requested", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(fixture))));
    const r = await fetchNavitime("rk", REQ, NOW, fetcher);
    expect(r.status).toBe("ok");
    const [input, init] = fetcher.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.host).toBe("navitime-route-totalnavi.p.rapidapi.com");
    expect(url.pathname).toBe("/route_transit");
    expect(url.searchParams.get("shape")).toBe("true");
    expect(url.searchParams.get("start")).toBe("35.681236,139.767125");
    expect(url.searchParams.get("start_time")).toBe("2026-11-18T09:00:00");
    expect(new Headers(init?.headers).get("x-rapidapi-key")).toBe("rk");
  });

  it("hides the provider's error body from the client", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response("quota exceeded for key rk", { status: 429 })));
    expect(await fetchNavitime("rk", REQ, NOW, fetcher)).toEqual({ status: "error", message: "navitime_429" });
  });
});
