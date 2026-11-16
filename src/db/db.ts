import Dexie, { type EntityTable, type Table } from "dexie";
import type { AnyRow, Attachment, Day, Leg, Reservation, Stop, SyncTable, Trip } from "../../shared/schema";

export type OutboxEntry = { table: SyncTable; id: string; row: AnyRow; queued_at: number };
export type MetaEntry = { key: string; value: unknown };
/** Attachment file contents, kept locally so they open offline. */
export type BlobEntry = { id: string; blob: Blob };

export class TravelDB extends Dexie {
  declare trips: EntityTable<Trip, "id">;
  declare days: EntityTable<Day, "id">;
  declare stops: EntityTable<Stop, "id">;
  declare legs: EntityTable<Leg, "id">;
  declare reservations: EntityTable<Reservation, "id">;
  declare attachments: EntityTable<Attachment, "id">;
  declare outbox: Table<OutboxEntry, [SyncTable, string]>;
  declare meta: EntityTable<MetaEntry, "key">;
  declare blobs: EntityTable<BlobEntry, "id">;

  constructor(name = "travel-planner") {
    super(name);
    this.version(1).stores({
      trips: "id, start_date",
      days: "id, trip_id, [trip_id+date]",
      stops: "id, trip_id, day_id, [day_id+position]",
      legs: "id, trip_id, [from_stop_id+to_stop_id]",
      reservations: "id, trip_id, stop_id",
      attachments: "id, reservation_id",
      outbox: "[table+id], queued_at",
      meta: "key",
    });
    this.version(2).stores({ blobs: "id" });
  }

  syncTable(table: SyncTable): Table<AnyRow, string> {
    return this.table(table);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export const SYNC_STORES = ["trips", "days", "stops", "legs", "reservations", "attachments"] as const satisfies readonly SyncTable[];

export const db = new TravelDB();

/** Removes every local row, queued change and sync cursor (logout, or a different account signed in). */
export async function clearLocalData(database: TravelDB = db): Promise<void> {
  await database.transaction("rw", database.tables, async () => {
    await Promise.all(database.tables.map((t) => t.clear()));
  });
}
