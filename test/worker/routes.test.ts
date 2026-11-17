import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompareRequest, CompareResponse } from "../../shared/routes";
import app from "../../worker/index";
import { computeRoute, normalizeSteps } from "../../worker/routes/google";
import { isAllowedMapsUrl, resolveShareLink } from "../../worker/routes/links";
import navitimeFixture from "../fixtures/navitime-tokyo-shinjuku.json";
import { BASE, api, loggedInCookie } from "./helpers";

const NOW = Date.UTC(2027, 2, 1);
const REQ: CompareRequest = {
  origin: { placeId: "ChIJ-inari" },
  destination: { lat: 34.9948, lng: 135.785 },
  departAt: Date.UTC(2027, 2, 26, 2, 0),
};

const googleRoute = {
  routes: [
    {
      duration: "1920s",
      distanceMeters: 4100,
      polyline: { encodedPolyline: "abc" },
      legs: [
        {
          steps: [
            { travelMode: "WALK", staticDuration: "120s" },
            { travelMode: "WALK", staticDuration: "180s" },
            {
              travelMode: "TRANSIT",
              staticDuration: "420s",
              transitDetails: {
                headsign: "出町柳",
                stopCount: 4,
                stopDetails: {
                  departureStop: { name: "伏見稻荷" },
                  arrivalStop: { name: "清水五條" },
                  departureTime: "2027-03-26T02:05:00Z",
                },
                transitLine: { name: "京阪本線", vehicle: { name: { text: "電車" } } },
              },
            },
            { travelMode: "WALK", staticDuration: "1200s" },
          ],
        },
      ],
    },
  ],
};

function fakeFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.restoreAllMocks();
});

function bodyText(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("expected a JSON string body");
  return init.body;
}

function urlOf(input: RequestInfo | URL | undefined): string {
  if (input === undefined) return "";
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("computeRoute", () => {
  it("sends an Essentials-only request and normalises the transit steps", async () => {
    const fetcher = fakeFetch(googleRoute);
    const result = await computeRoute("key-1", REQ, "transit", NOW, fetcher);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Goog-Api-Key")).toBe("key-1");
    expect(headers.get("X-Goog-FieldMask")).not.toMatch(/travelAdvisory|localized/);
    const body = JSON.parse(bodyText(init)) as Record<string, unknown>;
    expect(body).toMatchObject({
      origin: { placeId: "ChIJ-inari" },
      destination: { location: { latLng: { latitude: 34.9948, longitude: 135.785 } } },
      travelMode: "TRANSIT",
      departureTime: "2027-03-26T02:00:00.000Z",
    });
    expect(body).not.toHaveProperty("routingPreference");

    expect(result).toEqual({
      status: "ok",
      minutes: 32,
      distanceMeters: 4100,
      polyline: "abc",
      steps: [
        { kind: "walk", minutes: 5 },
        {
          kind: "transit",
          minutes: 7,
          line: "京阪本線",
          vehicle: "電車",
          headsign: "出町柳",
          stops: 4,
          from: "伏見稻荷",
          to: "清水五條",
          departAt: "2027-03-26T02:05:00Z",
        },
        { kind: "walk", minutes: 20 },
      ],
    });
  });

  it("never sends a departure time for modes that do not need it", async () => {
    const fetcher = fakeFetch(googleRoute);
    await computeRoute("k", REQ, "drive", NOW, fetcher);
    const body = JSON.parse(bodyText(fetcher.mock.calls[0]?.[1])) as Record<string, unknown>;
    expect(body.travelMode).toBe("DRIVE");
    expect(body).not.toHaveProperty("departureTime");
    expect(body).not.toHaveProperty("routingPreference");
  });

  it("does not call Google for transit outside the 100-day window", async () => {
    const fetcher = fakeFetch(googleRoute);
    const far = { ...REQ, departAt: NOW + 101 * 86_400_000 };
    expect(await computeRoute("k", far, "transit", NOW, fetcher)).toEqual({ status: "out_of_range" });
    expect(await computeRoute("k", { ...REQ, departAt: NOW - 8 * 86_400_000 }, "transit", NOW, fetcher)).toEqual({
      status: "out_of_range",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports no route and hides Google's error details", async () => {
    expect(await computeRoute("k", REQ, "walk", NOW, fakeFetch({}))).toEqual({ status: "no_route" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await computeRoute("k", REQ, "walk", NOW, fakeFetch({ error: { message: "API key invalid: k" } }, 403))).toEqual({
      status: "error",
      message: "google_403",
    });
  });

  it("merges consecutive non-transit steps", () => {
    expect(normalizeSteps([{ travelMode: "DRIVE", staticDuration: "60s" }, { travelMode: "DRIVE", staticDuration: "90s" }])).toEqual([
      { kind: "other", minutes: 3, mode: "DRIVE" },
    ]);
  });
});

async function compare(overrides: Partial<Env>, body: unknown, cookie: string) {
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`${BASE}/api/routes/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(body),
    }),
    { ...env, ...overrides },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /api/routes/compare", () => {
  it("reports not_configured for every mode without a server key", async () => {
    const res = await api("/api/routes/compare", {
      method: "POST",
      cookie: await loggedInCookie(),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(REQ),
    });
    const data = await res.json<CompareResponse>();
    expect(Object.values(data.results)).toEqual(Array(4).fill({ status: "not_configured" }));
  });

  it("validates the request and requires a session", async () => {
    const cookie = await loggedInCookie();
    expect((await compare({}, { origin: {}, destination: REQ.destination, departAt: null }, cookie)).status).toBe(400);
    expect((await compare({}, REQ, "")).status).toBe(401);
  });

  it("caches results in D1 only when a TTL is configured", async () => {
    const cookie = await loggedInCookie();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(googleRoute))));
    const body = { ...REQ, departAt: Date.now() + 86_400_000, modes: ["walk"] };

    await compare({ GOOGLE_ROUTES_KEY: "k" }, body, cookie);
    await compare({ GOOGLE_ROUTES_KEY: "k" }, body, cookie);
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockClear();
    const cached = { GOOGLE_ROUTES_KEY: "k", ROUTE_CACHE_TTL_HOURS: "24" };
    const first = await (await compare(cached, body, cookie)).json<CompareResponse>();
    const second = await (await compare(cached, body, cookie)).json<CompareResponse>();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first.results.walk?.status).toBe("ok");
  });

  describe("NAVITIME for transit in Japan", () => {
    const TOKYO = { origin: { lat: 35.681236, lng: 139.767125 }, destination: { lat: 35.689592, lng: 139.700413 } };
    const rapidCalls = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.filter(([input]) => urlOf(input as RequestInfo).includes("rapidapi.com")).length;

    it("reuses one result for the pair whatever the departure, until asked to refresh", async () => {
      const cookie = await loggedInCookie();
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(navitimeFixture))));
      const keys = { RAPIDAPI_KEY: "r", NAVITIME_CACHE_TTL_DAYS: "30" };
      const at9 = await (await compare(keys, { ...TOKYO, departAt: Date.now() + 86_400_000, modes: ["transit"] }, cookie)).json<CompareResponse>();
      const at18 = await (await compare(keys, { ...TOKYO, departAt: Date.now() + 5 * 86_400_000, modes: ["transit"] }, cookie)).json<CompareResponse>();
      expect(rapidCalls(spy)).toBe(1);
      expect(at18).toEqual(at9);
      expect(at9.results.transit).toMatchObject({ status: "ok", provider: "navitime", minutes: 26 });

      await compare(keys, { ...TOKYO, departAt: null, modes: ["transit"], refresh: true }, cookie);
      expect(rapidCalls(spy)).toBe(2);
    });

    it("does not cache when the TTL is 0", async () => {
      const cookie = await loggedInCookie();
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(navitimeFixture))));
      const keys = { RAPIDAPI_KEY: "r", NAVITIME_CACHE_TTL_DAYS: "0" };
      const body = { ...TOKYO, origin: { lat: 34.98, lng: 135.75 }, departAt: null, modes: ["transit"] };
      await compare(keys, body, cookie);
      await compare(keys, body, cookie);
      expect(rapidCalls(spy)).toBe(2);
    });

    it("leaves place-only stops and non-transit modes to Google", async () => {
      const cookie = await loggedInCookie();
      const spy = vi.spyOn(globalThis, "fetch");
      const res = await (
        await compare({ RAPIDAPI_KEY: "r" }, { origin: { placeId: "ChIJ-x" }, destination: TOKYO.destination, departAt: null }, cookie)
      ).json<CompareResponse>();
      expect(Object.values(res.results)).toEqual(Array(4).fill({ status: "not_configured" }));
      expect(rapidCalls(spy)).toBe(0);
    });

    it("counts routes as enabled with only the RapidAPI key", async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(new Request(`${BASE}/api/config`, { headers: { Cookie: await loggedInCookie() } }), { ...env, RAPIDAPI_KEY: "r" }, ctx);
      expect(await res.json()).toMatchObject({ routesEnabled: true });
    });
  });
});

describe("share links", () => {
  it.each([
    ["https://maps.app.goo.gl/abc123", true],
    ["https://www.google.com/maps/place/x", true],
    ["https://maps.google.co.jp/?q=1,2", true],
    ["http://maps.app.goo.gl/abc", false],
    ["https://evil.example/maps.app.goo.gl", false],
    ["https://google.com.evil.example/", false],
    ["https://169.254.169.254/", false],
  ])("%s allowed: %s", (url, ok) => {
    expect(isAllowedMapsUrl(url)).toBe(ok);
  });

  it("follows redirects between Google hosts and refuses to leave them", async () => {
    const hops = new Map([
      ["https://maps.app.goo.gl/abc", "https://www.google.com/maps/place/X/@35,135,15z"],
      ["https://maps.app.goo.gl/bad", "https://evil.example/steal"],
    ]);
    const fetcher = vi.fn<typeof fetch>((input) => {
      const next = hops.get(urlOf(input));
      return Promise.resolve(next ? new Response(null, { status: 302, headers: { Location: next } }) : new Response("ok"));
    });
    expect(await resolveShareLink("https://maps.app.goo.gl/abc", fetcher)).toBe("https://www.google.com/maps/place/X/@35,135,15z");
    expect(await resolveShareLink("https://maps.app.goo.gl/bad", fetcher)).toBeNull();
    expect(fetcher.mock.calls.map((c) => urlOf(c[0]))).not.toContain("https://evil.example/steal");
  });
});
