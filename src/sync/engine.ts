import {
  MAX_PUSH_CHANGES,
  type AnyRow,
  type PullResponse,
  type PushResponse,
  type SyncChange,
  type SyncTable,
} from "../../shared/schema";
import { ApiError, NetworkError, apiRequest } from "../api/client";
import type { OutboxEntry, TravelDB } from "../db/db";
import { onLocalWrite } from "../db/mutate";

export interface SyncTransport {
  push(changes: SyncChange[]): Promise<PushResponse>;
  pull(since: number): Promise<PullResponse>;
}

export const httpTransport: SyncTransport = {
  push: (changes) => apiRequest<PushResponse>("/api/sync/push", { json: { changes } }),
  pull: (since) => apiRequest<PullResponse>(`/api/sync/pull?since=${since}`),
};

export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "unauthorized";
export type SyncStatus = { phase: SyncPhase; lastSyncAt: number | null };

const CURSOR_KEY = "syncCursor";
const LAST_SYNC_KEY = "lastSyncAt";
const DEBOUNCE_MS = 1000;
const INTERVAL_MS = 60_000;

const key = (table: SyncTable, id: string): [SyncTable, string] => [table, id];

export class SyncEngine {
  private status: SyncStatus = { phase: "idle", lastSyncAt: null };
  private readonly subscribers = new Set<() => void>();
  private running: Promise<void> | null = null;
  private rerun = false;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private teardown: (() => void)[] = [];

  constructor(
    private readonly db: TravelDB,
    private readonly transport: SyncTransport,
    private readonly onUnauthorized: () => void = () => undefined,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  };

  getStatus = (): SyncStatus => this.status;

  private setStatus(next: Partial<SyncStatus>) {
    this.status = { ...this.status, ...next };
    for (const s of this.subscribers) s();
  }

  /** Starts automatic sync: now, after local writes, when back online or visible, and every minute. */
  start(): void {
    this.stop();
    void this.db.getMeta<number>(LAST_SYNC_KEY).then((lastSyncAt) => {
      if (lastSyncAt) this.setStatus({ lastSyncAt });
    });
    const trigger = () => {
      void this.syncNow();
    };
    this.teardown.push(onLocalWrite(() => {
      this.schedule();
    }));
    if (typeof window !== "undefined") {
      const onVisible = () => {
        if (document.visibilityState === "visible") trigger();
      };
      window.addEventListener("online", trigger);
      document.addEventListener("visibilitychange", onVisible);
      const interval = setInterval(() => {
        if (document.visibilityState === "visible") trigger();
      }, INTERVAL_MS);
      this.teardown.push(() => {
        window.removeEventListener("online", trigger);
        document.removeEventListener("visibilitychange", onVisible);
        clearInterval(interval);
      });
    }
    trigger();
  }

  stop(): void {
    for (const fn of this.teardown) fn();
    this.teardown = [];
    clearTimeout(this.debounce);
  }

  schedule(delay = DEBOUNCE_MS): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      void this.syncNow();
    }, delay);
  }

  /** Runs one push-then-pull cycle; concurrent calls coalesce into at most one extra run. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      let again = true;
      while (again) {
        this.rerun = false;
        await this.cycle();
        again = this.rerunRequested();
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Another trigger arrived during the last cycle; only worth acting on if that cycle succeeded. */
  private rerunRequested(): boolean {
    return this.rerun && this.status.phase === "idle";
  }

  private async cycle(): Promise<void> {
    if (typeof navigator !== "undefined" && (navigator.onLine as boolean | undefined) === false) {
      this.setStatus({ phase: "offline" });
      return;
    }
    this.setStatus({ phase: "syncing" });
    try {
      await this.pushAll();
      await this.pullAll();
      const lastSyncAt = Date.now();
      await this.db.setMeta(LAST_SYNC_KEY, lastSyncAt);
      this.setStatus({ phase: "idle", lastSyncAt });
    } catch (error) {
      if (error instanceof NetworkError) {
        this.setStatus({ phase: "offline" });
      } else if (error instanceof ApiError && error.status === 401) {
        this.setStatus({ phase: "unauthorized" });
        this.stop();
        this.onUnauthorized();
      } else {
        console.error("Sync failed", error);
        this.setStatus({ phase: "error" });
      }
    }
  }

  private async pushAll(): Promise<void> {
    for (;;) {
      const batch = await this.db.outbox.orderBy("queued_at").limit(MAX_PUSH_CHANGES).toArray();
      if (batch.length === 0) return;
      const sent = batch.map((e) => ({ table: e.table, row: e.row }) as SyncChange);
      const res = await this.transport.push(sent);
      const progressed = await this.applyPushResult(batch, res);
      if (!progressed) return;
    }
  }

  /** Clears outbox entries the server has settled, unless they were edited again meanwhile. */
  private async applyPushResult(batch: OutboxEntry[], res: PushResponse): Promise<boolean> {
    const sentAt = new Map(batch.map((e) => [`${e.table}/${e.id}`, e.row.updated_at]));
    let progressed = false;
    const tables = [...new Set(batch.map((e) => e.table))].map((t) => this.db.syncTable(t));

    await this.db.transaction("rw", [...tables, this.db.outbox], async () => {
      const settle = async (table: SyncTable, id: string): Promise<boolean> => {
        const entry = await this.db.outbox.get(key(table, id));
        if (!entry || entry.row.updated_at !== sentAt.get(`${table}/${id}`)) return false;
        await this.db.outbox.delete(key(table, id));
        progressed = true;
        return true;
      };
      for (const { table, id } of res.applied) await settle(table, id);
      for (const { table, row } of res.stale) {
        if (await settle(table, row.id)) await this.db.syncTable(table).put(row);
      }
      // A rejected row would be rejected again on every retry, so it leaves the queue.
      for (const { table, id, reason } of res.rejected) {
        if (id && sentAt.has(`${table}/${id}`) && (await settle(table as SyncTable, id))) {
          console.warn(`Dropped change ${table}/${id} rejected by server: ${reason}`);
        }
      }
    });
    return progressed;
  }

  private async pullAll(): Promise<void> {
    let cursor = (await this.db.getMeta<number>(CURSOR_KEY)) ?? 0;
    for (;;) {
      const page = await this.transport.pull(cursor);
      const tables = [...new Set(page.changes.map((c) => c.table))].map((t) => this.db.syncTable(t));
      await this.db.transaction("rw", [...tables, this.db.outbox, this.db.meta], async () => {
        for (const { table, row } of page.changes) {
          // A pending local edit wins here; the next push resolves it against the server.
          if (await this.db.outbox.get(key(table, row.id))) continue;
          const store = this.db.syncTable(table);
          const local: AnyRow | undefined = await store.get(row.id);
          if (!local || row.updated_at >= local.updated_at) await store.put(row);
        }
        await this.db.setMeta(CURSOR_KEY, page.cursor);
      });
      cursor = page.cursor;
      if (!page.more) return;
    }
  }
}
