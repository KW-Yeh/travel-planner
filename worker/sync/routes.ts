import { Hono } from "hono";
import {
  DEFAULT_PULL_LIMIT,
  MAX_CLOCK_SKEW_MS,
  MAX_PUSH_CHANGES,
  SYNC_SCHEMAS,
  SYNC_TABLES,
  type AnyRow,
  type PullResponse,
  type PushResponse,
  type SyncChange,
  type SyncTable,
} from "../../shared/schema";
import { apiError, readJson } from "../http";
import type { AppEnv } from "../types";

/** Columns the server fills in itself; anything a client sends for them is ignored. */
const SERVER_OWNED: Partial<Record<SyncTable, Record<string, (userId: string, row: AnyRow) => string | number>>> = {
  attachments: {
    r2_key: (userId, row) => `users/${userId}/attachments/${row.id}`,
    uploaded: () => 0,
  },
};

/** Columns stripped from rows sent back to clients. */
const SERVER_ONLY_COLUMNS = new Set(["user_id", "version", "r2_key"]);

function isSyncTable(name: string): name is SyncTable {
  return (SYNC_TABLES as string[]).includes(name);
}

function clientColumns(table: SyncTable): string[] {
  const owned = SERVER_OWNED[table] ?? {};
  return Object.keys(SYNC_SCHEMAS[table].shape).filter((k) => !(k in owned));
}

const COLUMNS: Record<SyncTable, string[]> = Object.fromEntries(SYNC_TABLES.map((t) => [t, clientColumns(t)])) as Record<
  SyncTable,
  string[]
>;

function toSyncChange(table: SyncTable, raw: Record<string, unknown>): SyncChange {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!SERVER_ONLY_COLUMNS.has(k)) row[k] = v;
  return { table, row } as SyncChange;
}

export const syncRoutes = new Hono<AppEnv>();

syncRoutes.post("/push", async (c) => {
  const body = await readJson(c);
  if (!body.ok) return body.response;
  const changes = (body.value as { changes?: unknown }).changes;
  if (!Array.isArray(changes) || changes.length > MAX_PUSH_CHANGES) return apiError(c, 400, "bad_request");

  const { userId } = c.var.session;
  const now = Date.now();
  const result: PushResponse = { applied: [], stale: [], rejected: [] };

  type Valid = { table: SyncTable; row: AnyRow };
  const valid: Valid[] = [];
  for (const change of changes as { table?: unknown; row?: unknown }[]) {
    const table = typeof change.table === "string" ? change.table : "";
    const rawId = (change.row as { id?: unknown } | undefined)?.id;
    const rowId = typeof rawId === "string" ? rawId : null;
    if (!isSyncTable(table)) {
      result.rejected.push({ table, id: rowId, reason: "unknown_table" });
      continue;
    }
    const parsed = SYNC_SCHEMAS[table].safeParse(change.row);
    if (!parsed.success) {
      result.rejected.push({ table, id: rowId, reason: "invalid_row" });
      continue;
    }
    const row = { ...parsed.data, updated_at: Math.min(parsed.data.updated_at, now + MAX_CLOCK_SKEW_MS) };
    valid.push({ table, row });
  }

  if (valid.length > 0) {
    const db = c.env.DB;
    const n = valid.length;
    // Reserving the versions and writing the rows in one batch (one transaction) keeps
    // versions in commit order, so a concurrent pull can never skip past an earlier write.
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          "INSERT INTO sync_counter (user_id, value) VALUES (?1, ?2) ON CONFLICT (user_id) DO UPDATE SET value = value + ?2",
        )
        .bind(userId, n),
    ];
    valid.forEach(({ table, row }, i) => {
      const cols = COLUMNS[table];
      const owned = SERVER_OWNED[table] ?? {};
      const ownedCols = Object.keys(owned);
      const allCols = [...cols, ...ownedCols, "user_id", "version"];
      const placeholders = [...cols, ...ownedCols, "user_id"].map(() => "?");
      const values = [
        ...cols.map((col) => (row as Record<string, unknown>)[col] ?? null),
        ...ownedCols.map((col) => {
          const fill = owned[col];
          if (!fill) throw new Error(`missing filler for ${col}`);
          return fill(userId, row);
        }),
        userId,
        userId,
        n - i,
      ];
      const updates = cols.filter((col) => col !== "id").map((col) => `${col} = excluded.${col}`);
      statements.push(
        db
          .prepare(
            `INSERT INTO ${table} (${allCols.join(", ")})
             VALUES (${placeholders.join(", ")}, (SELECT value FROM sync_counter WHERE user_id = ?) - ? + 1)
             ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}, version = excluded.version
             WHERE excluded.updated_at > ${table}.updated_at AND ${table}.user_id = excluded.user_id`,
          )
          .bind(...values),
      );
    });

    const results = await db.batch(statements);
    const staleByTable = new Map<SyncTable, string[]>();
    valid.forEach(({ table, row }, i) => {
      if ((results[i + 1]?.meta.changes ?? 0) > 0) {
        result.applied.push({ table, id: row.id });
      } else {
        staleByTable.set(table, [...(staleByTable.get(table) ?? []), row.id]);
      }
    });

    for (const [table, ids] of staleByTable) {
      const { results: rows } = await db
        .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})`)
        .bind(userId, ...ids)
        .all();
      const found = new Set<string>();
      for (const raw of rows) {
        found.add(raw.id as string);
        result.stale.push(toSyncChange(table, raw));
      }
      // The id exists but belongs to another user: never reveal it, just refuse.
      for (const id of ids) if (!found.has(id)) result.rejected.push({ table, id, reason: "conflict" });
    }
  }

  return c.json(result);
});

syncRoutes.get("/pull", async (c) => {
  const since = Number(c.req.query("since") ?? "0");
  const limit = Math.min(Number(c.req.query("limit") ?? DEFAULT_PULL_LIMIT), DEFAULT_PULL_LIMIT);
  if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit) || limit < 1) {
    return apiError(c, 400, "bad_request");
  }
  const { userId } = c.var.session;

  const perTable = await c.env.DB.batch(
    SYNC_TABLES.map((table) =>
      c.env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND version > ? ORDER BY version LIMIT ?`).bind(
        userId,
        since,
        limit + 1,
      ),
    ),
  );

  const merged: { version: number; change: SyncChange }[] = [];
  perTable.forEach((res, i) => {
    const table = SYNC_TABLES[i];
    if (!table) return;
    for (const raw of res.results as Record<string, unknown>[]) {
      merged.push({ version: raw.version as number, change: toSyncChange(table, raw) });
    }
  });
  merged.sort((a, b) => a.version - b.version);

  const page = merged.slice(0, limit);
  const response: PullResponse = {
    changes: page.map((m) => m.change),
    cursor: page.at(-1)?.version ?? since,
    more: merged.length > limit,
  };
  return c.json(response);
});
