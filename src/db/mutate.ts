import type { RowOf, SyncTable } from "../../shared/schema";
import { db as defaultDb, type TravelDB } from "./db";

export type Draft<T extends SyncTable> = Omit<RowOf<T>, "updated_at" | "deleted"> & { deleted?: 0 | 1 };
export type DraftChange = { [T in SyncTable]: { table: T; row: Draft<T> } }[SyncTable];

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notified after every local write, so the sync engine can schedule an upload. */
export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Writes rows locally and queues them for upload in one transaction. updated_at is always
 * strictly greater than the previous local value, even if the device clock went backwards,
 * so a later local edit can never lose to an earlier one from the same device.
 */
export async function writeRows(changes: DraftChange[], database: TravelDB = defaultDb): Promise<void> {
  if (changes.length === 0) return;
  const tables = [...new Set(changes.map((c) => c.table))].map((t) => database.syncTable(t));
  await database.transaction("rw", [...tables, database.outbox], async () => {
    const now = Date.now();
    for (const { table, row } of changes) {
      const store = database.syncTable(table);
      const previous = await store.get(row.id);
      const stamped = { ...row, deleted: row.deleted ?? 0, updated_at: Math.max(now, (previous?.updated_at ?? 0) + 1) };
      await store.put(stamped);
      await database.outbox.put({ table, id: row.id, row: stamped, queued_at: now });
    }
  });
  for (const listener of listeners) listener();
}

export async function updateRow<T extends SyncTable>(
  table: T,
  id: string,
  patch: Partial<Draft<T>>,
  database: TravelDB = defaultDb,
): Promise<void> {
  const current = await database.syncTable(table).get(id);
  if (!current) throw new Error(`${table}/${id} not found`);
  await writeRows([{ table, row: { ...current, ...patch } } as DraftChange], database);
}

export async function softDelete(table: SyncTable, ids: string[], database: TravelDB = defaultDb): Promise<void> {
  const rows = await database.syncTable(table).bulkGet(ids);
  await writeRows(
    rows.filter((r) => r !== undefined).map((row) => ({ table, row: { ...row, deleted: 1 } }) as DraftChange),
    database,
  );
}
