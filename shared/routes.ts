import { z } from "zod";
import { LEG_MODES, type LegMode } from "./schema";

const Endpoint = z
  .object({
    placeId: z.string().min(1).max(300).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine((e) => e.placeId !== undefined || (e.lat !== undefined && e.lng !== undefined), "placeId or lat/lng required");
export type Endpoint = z.infer<typeof Endpoint>;

export const CompareRequest = z.object({
  origin: Endpoint,
  destination: Endpoint,
  /** Planned departure (epoch ms); null when the day has no date. */
  departAt: z.number().int().nullable(),
  modes: z.array(z.enum(LEG_MODES)).min(1).max(4).optional(),
  /** Skip cached results and ask the provider again. */
  refresh: z.boolean().optional(),
});
export type CompareRequest = z.infer<typeof CompareRequest>;

export type RouteStep =
  | { kind: "walk"; minutes: number }
  | {
      kind: "transit";
      minutes: number;
      line: string;
      vehicle: string | null;
      headsign: string | null;
      stops: number | null;
      from: string | null;
      to: string | null;
      departAt: string | null;
      /** Line colour (NAVITIME), e.g. "#F15A22". */
      color?: string | null;
      /** Exit to take at the arrival station (NAVITIME). */
      exit?: string | null;
    }
  | { kind: "other"; minutes: number; mode: string };

export type RouteResult =
  | {
      status: "ok";
      minutes: number;
      distanceMeters: number;
      polyline: string | null;
      steps: RouteStep[];
      provider?: "google" | "navitime";
    }
  | { status: "no_route" }
  | { status: "out_of_range" }
  | { status: "not_configured" }
  | { status: "error"; message: string };

export type CompareResponse = { results: Partial<Record<LegMode, RouteResult>> };

export type ConfigResponse = { mapsBrowserKey: string | null; mapId: string | null; routesEnabled: boolean };

/** Google only computes transit for departures from 7 days ago to 100 days ahead. */
export const TRANSIT_PAST_MS = 7 * 86_400_000;
export const TRANSIT_FUTURE_MS = 100 * 86_400_000;

/** Short text for the timeline row, e.g. the first transit line used. */
export function primaryLine(steps: RouteStep[]): string {
  const first = steps.find((s) => s.kind === "transit");
  return first?.kind === "transit" ? first.line : "";
}
