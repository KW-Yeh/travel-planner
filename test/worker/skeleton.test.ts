import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, loggedInCookie } from "./helpers";

describe("worker skeleton", () => {
  it("answers the health check", async () => {
    const res = await exports.default.fetch("http://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("requires a session before revealing whether an API route exists", async () => {
    const res = await exports.default.fetch("http://example.com/api/nope");
    expect(res.status).toBe(401);
  });

  it("returns JSON 404 for unknown API routes when signed in", async () => {
    const res = await api("/api/nope", { cookie: await loggedInCookie() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("applies the initial migration", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name <> '_cf_KV' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      "attachments",
      "days",
      "legs",
      "login_attempts",
      "reservations",
      "route_cache",
      "sessions",
      "stops",
      "sync_counter",
      "trips",
      "users",
    ]);
  });

  it("allows only one live leg per stop pair", async () => {
    const insert = env.DB.prepare(
      "INSERT INTO legs (id, user_id, trip_id, from_stop_id, to_stop_id, mode, source, updated_at, deleted, version) VALUES (?, 'u1', 't1', 'a', 'b', 'transit', 'manual', 1, ?, 1)",
    );
    await insert.bind("leg-1", 1).run();
    await insert.bind("leg-2", 0).run();
    await expect(insert.bind("leg-3", 0).run()).rejects.toThrow(/UNIQUE/);
  });

  it("requires fixed_time when arrival_mode is fixed", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO stops (id, user_id, trip_id, position, name, kind, arrival_mode, stay_minutes, updated_at, version) VALUES ('s1', 'u1', 't1', 'a0', 'X', 'sight', 'fixed', 30, 1, 1)",
      ).run(),
    ).rejects.toThrow(/CHECK/);
  });

  it("has R2 bound for attachments", async () => {
    await env.ATTACHMENTS.put("probe", "ok");
    expect(await (await env.ATTACHMENTS.get("probe"))?.text()).toBe("ok");
  });
});
