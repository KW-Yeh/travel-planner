import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { PullResponse, PushResponse, Trip } from "../../shared/schema";
import { createSession } from "../../worker/auth/session";
import { api, loggedInCookie } from "./helpers";

let cookie: string;

beforeEach(async () => {
  cookie = await loggedInCookie();
});

function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: crypto.randomUUID(),
    updated_at: 1_000,
    deleted: 0,
    name: "京都",
    start_date: "2027-03-26",
    end_date: "2027-03-28",
    party_size: 2,
    time_zone: "Asia/Tokyo",
    ...overrides,
  };
}

async function push(changes: unknown[], as = cookie): Promise<PushResponse> {
  const res = await api("/api/sync/push", {
    method: "POST",
    cookie: as,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  expect(res.status).toBe(200);
  return res.json<PushResponse>();
}

async function pull(since: number, limit?: number, as = cookie): Promise<PullResponse> {
  const q = limit ? `since=${since}&limit=${limit}` : `since=${since}`;
  const res = await api(`/api/sync/pull?${q}`, { cookie: as });
  expect(res.status).toBe(200);
  return res.json<PullResponse>();
}

async function otherUserCookie(): Promise<string> {
  const userId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, 0)").bind(userId, `other-${userId}`).run();
  const { cookieValue } = await createSession(env.DB, env.SESSION_SECRET, userId, undefined, Date.now());
  return `__Host-tp_session=${cookieValue}`;
}

describe("sync push", () => {
  it("applies a new row and returns it on pull without server-only columns", async () => {
    const t = trip();
    const res = await push([{ table: "trips", row: t }]);
    expect(res).toEqual({ applied: [{ table: "trips", id: t.id }], stale: [], rejected: [] });

    const pulled = await pull(0);
    expect(pulled.changes).toContainEqual({ table: "trips", row: t });
  });

  it("keeps the newer write and returns the server row for an older one", async () => {
    const t = trip({ updated_at: 2_000, name: "newer" });
    await push([{ table: "trips", row: t }]);

    const older = await push([{ table: "trips", row: { ...t, updated_at: 1_500, name: "older" } }]);
    expect(older.applied).toEqual([]);
    expect(older.stale).toEqual([{ table: "trips", row: t }]);

    const tie = await push([{ table: "trips", row: { ...t, name: "same time" } }]);
    expect(tie.stale).toEqual([{ table: "trips", row: t }]);

    const newer = await push([{ table: "trips", row: { ...t, updated_at: 3_000, name: "newest" } }]);
    expect(newer.applied).toHaveLength(1);
  });

  it("clamps edits stamped far in the future", async () => {
    const t = trip({ updated_at: Date.now() + 365 * 86_400_000 });
    await push([{ table: "trips", row: t }]);
    const stored = await env.DB.prepare("SELECT updated_at FROM trips WHERE id = ?").bind(t.id).first<{ updated_at: number }>();
    expect(stored?.updated_at).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
  });

  it("rejects invalid rows and unknown tables without failing the batch", async () => {
    const good = trip();
    const res = await push([
      { table: "trips", row: good },
      { table: "trips", row: { ...trip(), party_size: 0 } },
      { table: "users", row: { id: "x" } },
      { table: "stops", row: { ...trip(), kind: "sight" } },
    ]);
    expect(res.applied).toEqual([{ table: "trips", id: good.id }]);
    expect(res.rejected.map((r) => r.reason)).toEqual(["invalid_row", "unknown_table", "invalid_row"]);
  });

  it("ignores user_id sent by the client", async () => {
    const t = trip();
    await push([{ table: "trips", row: { ...t, user_id: "someone-else" } }]);
    const me = await (await api("/api/auth/me", { cookie })).json<{ userId: string }>();
    const stored = await env.DB.prepare("SELECT user_id FROM trips WHERE id = ?").bind(t.id).first<{ user_id: string }>();
    expect(stored?.user_id).toBe(me.userId);
  });

  it("never lets one user overwrite or read another user's row", async () => {
    const other = await otherUserCookie();
    const theirs = trip({ name: "theirs" });
    await push([{ table: "trips", row: theirs }], other);

    const attempt = await push([{ table: "trips", row: { ...theirs, updated_at: 9_999, name: "hijack" } }]);
    expect(attempt.applied).toEqual([]);
    expect(attempt.stale).toEqual([]);
    expect(attempt.rejected).toEqual([{ table: "trips", id: theirs.id, reason: "conflict" }]);

    const mine = await pull(0);
    expect(mine.changes.map((c) => c.row.id)).not.toContain(theirs.id);
    const stored = await env.DB.prepare("SELECT name FROM trips WHERE id = ?").bind(theirs.id).first<{ name: string }>();
    expect(stored?.name).toBe("theirs");
  });

  it("does not accept the server-owned uploaded flag from clients", async () => {
    const att = {
      id: crypto.randomUUID(),
      updated_at: 1,
      deleted: 0,
      reservation_id: crypto.randomUUID(),
      filename: "a.pdf",
      content_type: "application/pdf",
      size: 10,
      uploaded: 1,
    };
    await push([{ table: "attachments", row: att }]);
    const stored = await env.DB.prepare("SELECT uploaded, r2_key FROM attachments WHERE id = ?")
      .bind(att.id)
      .first<{ uploaded: number; r2_key: string }>();
    expect(stored?.uploaded).toBe(0);
    expect(stored?.r2_key).toMatch(new RegExp(`^users/[0-9a-f-]+/attachments/${att.id}$`));
  });

  it("rejects more than 100 changes per push", async () => {
    const res = await api("/api/sync/push", {
      method: "POST",
      cookie,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: Array.from({ length: 101 }, () => ({ table: "trips", row: trip() })) }),
    });
    expect(res.status).toBe(400);
  });

  it("requires a session", async () => {
    const res = await api("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("sync pull", () => {
  it("returns changes in write order across tables and resumes from the cursor", async () => {
    const start = (await pull(0)).cursor;
    const t = trip();
    const day = { id: crypto.randomUUID(), updated_at: 1, deleted: 0, trip_id: t.id, date: "2027-03-26", depart_time: "09:00" };
    await push([{ table: "trips", row: t }]);
    await push([{ table: "days", row: day }]);
    await push([{ table: "trips", row: { ...t, updated_at: 5_000, name: "renamed" } }]);

    const after = await pull(start);
    expect(after.changes.map((c) => [c.table, c.row.id])).toEqual([
      ["days", day.id],
      ["trips", t.id],
    ]);
    expect(after.changes[1]?.row).toMatchObject({ name: "renamed" });
    expect(after.more).toBe(false);

    expect((await pull(after.cursor)).changes).toEqual([]);
  });

  it("delivers a late upload of an old edit to a device that already synced", async () => {
    const cursor = (await pull(0)).cursor;
    const offlineEdit = trip({ updated_at: 1 });
    await push([{ table: "trips", row: offlineEdit }]);
    const next = await pull(cursor);
    expect(next.changes.map((c) => c.row.id)).toContain(offlineEdit.id);
  });

  it("includes soft-deleted rows", async () => {
    const t = trip();
    await push([{ table: "trips", row: t }]);
    const cursor = (await pull(0)).cursor;
    await push([{ table: "trips", row: { ...t, updated_at: 2_000, deleted: 1 } }]);
    expect((await pull(cursor)).changes).toEqual([{ table: "trips", row: { ...t, updated_at: 2_000, deleted: 1 } }]);
  });

  it("pages with limit and more", async () => {
    const cursor = (await pull(0)).cursor;
    await push(Array.from({ length: 5 }, () => ({ table: "trips", row: trip() })));
    const first = await pull(cursor, 3);
    expect(first.changes).toHaveLength(3);
    expect(first.more).toBe(true);
    const second = await pull(first.cursor, 3);
    expect(second.changes).toHaveLength(2);
    expect(second.more).toBe(false);
  });

  it("rejects a bad cursor", async () => {
    expect((await api("/api/sync/pull?since=-1", { cookie })).status).toBe(400);
    expect((await api("/api/sync/pull?since=abc", { cookie })).status).toBe(400);
  });
});
