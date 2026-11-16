import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const id = z.uuid();
const epochMs = z.number().int().nonnegative();
const text = (max: number) => z.string().max(max);

const base = {
  id,
  updated_at: epochMs,
  deleted: z.union([z.literal(0), z.literal(1)]),
};

export const STOP_KINDS = ["sight", "food", "lodging", "transport", "other"] as const;
export const LEG_MODES = ["transit", "drive", "walk", "bicycle"] as const;
export const RESERVATION_STATUSES = ["confirmed", "pending", "payment_due"] as const;

export const TripRow = z.object({
  ...base,
  name: z.string().min(1).max(200),
  start_date: isoDate.nullable(),
  end_date: isoDate.nullable(),
  party_size: z.number().int().min(1).max(99),
  time_zone: z.string().min(1).max(64),
});

export const DayRow = z.object({
  ...base,
  trip_id: id,
  date: isoDate,
  depart_time: hhmm,
});

export const StopRow = z
  .object({
    ...base,
    trip_id: id,
    day_id: id.nullable(),
    position: z.string().min(1).max(128),
    place_id: text(300).nullable(),
    name: z.string().min(1).max(200),
    address: text(500).nullable(),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    place_fetched_at: epochMs.nullable(),
    kind: z.enum(STOP_KINDS),
    arrival_mode: z.enum(["auto", "fixed"]),
    fixed_time: hhmm.nullable(),
    stay_minutes: z.number().int().min(0).max(24 * 60),
    note: text(5000).nullable(),
  })
  .refine((s) => s.arrival_mode === "auto" || s.fixed_time !== null, { message: "fixed stops need fixed_time" });

export const LegRow = z.object({
  ...base,
  trip_id: id,
  from_stop_id: id,
  to_stop_id: id,
  mode: z.enum(LEG_MODES),
  minutes: z.number().int().min(0).max(48 * 60).nullable(),
  steps: text(50_000).nullable(),
  polyline: text(200_000).nullable(),
  source: z.enum(["google", "manual"]),
  fetched_at: epochMs.nullable(),
  query_depart_at: epochMs.nullable(),
  // Defaults so rows from app versions without notes (queued offline before an update) still validate.
  note: text(2000).nullable().default(null),
});

export const ReservationRow = z.object({
  ...base,
  trip_id: id,
  stop_id: id,
  time: hhmm.nullable(),
  party_size: z.number().int().min(1).max(999).nullable(),
  code: text(200).nullable(),
  url: text(2000).nullable(),
  status: z.enum(RESERVATION_STATUSES),
});

/**
 * Attachments are served from the app's own origin, so only inert types are allowed:
 * an uploaded HTML or SVG file would otherwise run script inside the app.
 */
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** `uploaded` is owned by the server (set when R2 receives the file); clients send it but it is ignored. */
export const AttachmentRow = z.object({
  ...base,
  reservation_id: id,
  filename: z.string().min(1).max(255),
  content_type: z.enum(ATTACHMENT_TYPES),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  uploaded: z.union([z.literal(0), z.literal(1)]),
});

export const SYNC_SCHEMAS = {
  trips: TripRow,
  days: DayRow,
  stops: StopRow,
  legs: LegRow,
  reservations: ReservationRow,
  attachments: AttachmentRow,
} as const;

export type SyncTable = keyof typeof SYNC_SCHEMAS;
export const SYNC_TABLES = Object.keys(SYNC_SCHEMAS) as SyncTable[];

export type Trip = z.infer<typeof TripRow>;
export type Day = z.infer<typeof DayRow>;
export type Stop = z.infer<typeof StopRow>;
export type Leg = z.infer<typeof LegRow>;
export type Reservation = z.infer<typeof ReservationRow>;
export type Attachment = z.infer<typeof AttachmentRow>;
export type StopKind = (typeof STOP_KINDS)[number];
export type LegMode = (typeof LEG_MODES)[number];
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export type RowOf<T extends SyncTable> = z.infer<(typeof SYNC_SCHEMAS)[T]>;
export type AnyRow = RowOf<SyncTable>;

export type SyncChange = { [T in SyncTable]: { table: T; row: RowOf<T> } }[SyncTable];

export const MAX_PUSH_CHANGES = 100;
export const DEFAULT_PULL_LIMIT = 500;

export type PushRequest = { changes: { table: string; row: unknown }[] };
export type PushResponse = {
  applied: { table: SyncTable; id: string }[];
  stale: SyncChange[];
  rejected: { table: string; id: string | null; reason: string }[];
};
export type PullResponse = { changes: SyncChange[]; cursor: number; more: boolean };

/** Last-writer-wins: an incoming row replaces the stored one only if strictly newer. */
export function isNewer(incoming: { updated_at: number }, existing: { updated_at: number } | undefined): boolean {
  return existing === undefined || incoming.updated_at > existing.updated_at;
}

/** Edits stamped further than this ahead of the server clock are clamped, so a fast clock cannot win forever. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
