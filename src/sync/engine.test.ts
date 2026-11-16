import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_SCHEMAS,
  isNewer,
  type AnyRow,
  type PullResponse,
  type PushResponse,
  type SyncChange,
  type Trip,
} from "../../shared/schema";
import { ApiError, NetworkError } from "../api/client";
import { TravelDB } from "../db/db";
import { newId } from "../db/ids";
import { writeRows, type Draft } from "../db/mutate";
import { SyncEngine, type SyncTransport } from "./engine";

/** In-memory stand-in for the Worker sync endpoints, following the same rules. */
class FakeServer implements SyncTransport {
  rows = new Map<string, { change: SyncChange; version: number }>();
  version = 0;
  pushes = 0;

  push(changes: SyncChange[]): Promise<PushResponse> {
    this.pushes++;
    const res: PushResponse = { applied: [], stale: [], rejected: [] };
    for (const change of changes) {
      if (!SYNC_SCHEMAS[change.table].safeParse(change.row).success) {
        res.rejected.push({ table: change.table, id: change.row.id, reason: "invalid_row" });
        continue;
      }
      const k = `${change.table}/${change.row.id}`;
      const existing = this.rows.get(k);
      if (isNewer(change.row, existing?.change.row)) {
        this.rows.set(k, { change: structuredClone(change), version: ++this.version });
        res.applied.push({ table: change.table, id: change.row.id });
      } else if (existing) {
        res.stale.push(structuredClone(existing.change));
      }
    }
    return Promise.resolve(res);
  }

  pull(since: number): Promise<PullResponse> {
    const changes = [...this.rows.values()].filter((r) => r.version > since).sort((a, b) => a.version - b.version);
    return Promise.resolve({
      changes: changes.map((c) => structuredClone(c.change)),
      cursor: changes.at(-1)?.version ?? since,
      more: false,
    });
  }
}

const databases: TravelDB[] = [];
function freshDb(): TravelDB {
  const database = new TravelDB(`test-${newId()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});

function trip(overrides: Partial<Draft<"trips">> = {}): Draft<"trips"> {
  return {
    id: newId(),
    name: "京都",
    start_date: "2027-03-26",
    end_date: "2027-03-28",
    party_size: 2,
    time_zone: "Asia/Tokyo",
    ...overrides,
  };
}

describe("local writes", () => {
  it("stamps updated_at, queues one outbox entry per row, and keeps only the latest edit", async () => {
    const database = freshDb();
    const t = trip();
    await writeRows([{ table: "trips", row: t }], database);
    await writeRows([{ table: "trips", row: { ...t, name: "改名" } }], database);

    const stored = await database.trips.get(t.id);
    expect(stored?.name).toBe("改名");
    expect(stored?.deleted).toBe(0);
    const outbox = await database.outbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.row).toEqual(stored);
  });

  it("keeps updated_at increasing even if the clock goes backwards", async () => {
    const database = freshDb();
    const t = trip();
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    await writeRows([{ table: "trips", row: t }], database);
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    await writeRows([{ table: "trips", row: { ...t, name: "later" } }], database);
    vi.restoreAllMocks();
    expect((await database.trips.get(t.id))?.updated_at).toBe(5_001);
  });
});

describe("sync engine", () => {
  it("pushes queued writes, then pulls; two devices converge", async () => {
    const server = new FakeServer();
    const a = freshDb();
    const b = freshDb();
    const engineA = new SyncEngine(a, server);
    const engineB = new SyncEngine(b, server);

    const t = trip();
    await writeRows([{ table: "trips", row: t }], a);
    await engineA.syncNow();
    expect(await a.outbox.count()).toBe(0);
    expect(engineA.getStatus().phase).toBe("idle");

    await engineB.syncNow();
    expect((await b.trips.get(t.id))?.name).toBe("京都");

    await writeRows([{ table: "trips", row: { ...t, name: "B 改的" } }], b);
    await engineB.syncNow();
    await engineA.syncNow();
    expect((await a.trips.get(t.id))?.name).toBe("B 改的");
  });

  it("keeps the newer edit when two offline devices change the same row", async () => {
    const server = new FakeServer();
    const a = freshDb();
    const b = freshDb();
    const engineA = new SyncEngine(a, server);
    const engineB = new SyncEngine(b, server);
    const t = trip();
    await writeRows([{ table: "trips", row: t }], a);
    await engineA.syncNow();
    await engineB.syncNow();

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    await writeRows([{ table: "trips", row: { ...t, name: "A 較新" } }], a);
    vi.restoreAllMocks();
    await writeRows([{ table: "trips", row: { ...t, name: "B 較舊" } }], b);

    await engineA.syncNow();
    await engineB.syncNow();
    await engineA.syncNow();
    expect((await a.trips.get(t.id))?.name).toBe("A 較新");
    expect((await b.trips.get(t.id))?.name).toBe("A 較新");
    expect(await b.outbox.count()).toBe(0);
  });

  it("does not drop an edit made while its previous version was being uploaded", async () => {
    const server = new FakeServer();
    const database = freshDb();
    const t = trip();
    await writeRows([{ table: "trips", row: t }], database);

    const racing: SyncTransport = {
      push: async (changes) => {
        await writeRows([{ table: "trips", row: { ...t, name: "上傳中又改" } }], database);
        return server.push(changes);
      },
      pull: (since) => server.pull(since),
    };
    await new SyncEngine(database, racing).syncNow();
    expect(await database.outbox.count()).toBe(1);
    expect((await database.trips.get(t.id))?.name).toBe("上傳中又改");

    await new SyncEngine(database, server).syncNow();
    expect(await database.outbox.count()).toBe(0);
    expect((server.rows.get(`trips/${t.id}`)?.change.row as Trip).name).toBe("上傳中又改");
  });

  it("does not let a pull overwrite a pending local edit", async () => {
    const server = new FakeServer();
    const database = freshDb();
    const t = trip();
    const remote: Trip = { ...t, deleted: 0, updated_at: 1, name: "server" };
    await server.push([{ table: "trips", row: remote }]);
    await writeRows([{ table: "trips", row: { ...t, name: "local" } }], database);

    const pullOnly: SyncTransport = { push: () => Promise.reject(new NetworkError("down")), pull: (s) => server.pull(s) };
    const engine = new SyncEngine(database, pullOnly);
    await engine.syncNow();
    expect((await database.trips.get(t.id))?.name).toBe("local");
  });

  it("reports offline and keeps the queue when the network is down", async () => {
    const database = freshDb();
    await writeRows([{ table: "trips", row: trip() }], database);
    const down: SyncTransport = {
      push: () => Promise.reject(new NetworkError(new TypeError("Failed to fetch"))),
      pull: () => Promise.reject(new NetworkError(new TypeError("Failed to fetch"))),
    };
    const engine = new SyncEngine(database, down);
    await engine.syncNow();
    expect(engine.getStatus().phase).toBe("offline");
    expect(await database.outbox.count()).toBe(1);

    await new SyncEngine(database, new FakeServer()).syncNow();
    expect(await database.outbox.count()).toBe(0);
  });

  it("signals unauthorized on 401 without touching local data", async () => {
    const database = freshDb();
    await writeRows([{ table: "trips", row: trip() }], database);
    const onUnauthorized = vi.fn();
    const expired: SyncTransport = {
      push: () => Promise.reject(new ApiError(401, "unauthorized")),
      pull: () => Promise.reject(new ApiError(401, "unauthorized")),
    };
    const engine = new SyncEngine(database, expired, onUnauthorized);
    await engine.syncNow();
    expect(engine.getStatus().phase).toBe("unauthorized");
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(await database.trips.count()).toBe(1);
    expect(await database.outbox.count()).toBe(1);
  });

  it("drops a change the server rejects so it cannot block the queue", async () => {
    const server = new FakeServer();
    const database = freshDb();
    const bad = { ...trip(), party_size: 0 } as unknown as Draft<"trips">;
    const good = trip();
    await writeRows([{ table: "trips", row: bad }, { table: "trips", row: good }], database);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await new SyncEngine(database, server).syncNow();
    expect(await database.outbox.count()).toBe(0);
    expect(server.rows.has(`trips/${good.id}`)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("applies soft deletes from other devices", async () => {
    const server = new FakeServer();
    const database = freshDb();
    const t: AnyRow = { ...trip(), deleted: 0, updated_at: 1 };
    await server.push([{ table: "trips", row: t }]);
    await new SyncEngine(database, server).syncNow();
    await server.push([{ table: "trips", row: { ...t, deleted: 1, updated_at: 2 } }]);
    await new SyncEngine(database, server).syncNow();
    expect((await database.trips.get(t.id))?.deleted).toBe(1);
  });

  it("generates ids the server schema accepts", () => {
    expect(SYNC_SCHEMAS.trips.shape.id.safeParse(newId()).success).toBe(true);
  });
});
