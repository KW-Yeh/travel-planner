import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Attachment, PullResponse } from "../../shared/schema";
import { MAX_ATTACHMENT_BYTES } from "../../shared/schema";
import { createSession } from "../../worker/auth/session";
import { api, loggedInCookie } from "./helpers";

let cookie: string;
beforeEach(async () => {
  cookie = await loggedInCookie();
});

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: crypto.randomUUID(),
    updated_at: 1,
    deleted: 0,
    reservation_id: crypto.randomUUID(),
    filename: "確認信.pdf",
    content_type: "application/pdf",
    size: 4,
    uploaded: 0,
    ...overrides,
  };
}

async function pushRow(row: Attachment, as = cookie) {
  const res = await api("/api/sync/push", {
    method: "POST",
    cookie: as,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes: [{ table: "attachments", row }] }),
  });
  expect(res.status).toBe(200);
  return res.json<{ applied: unknown[]; rejected: unknown[] }>();
}

function upload(id: string, body: BodyInit, type = "application/pdf", as = cookie) {
  return api(`/api/attachments/${id}`, { method: "PUT", cookie: as, headers: { "Content-Type": type }, body });
}

describe("attachments", () => {
  it("uploads to R2, marks the row uploaded for other devices, and serves it back", async () => {
    const row = attachment();
    await pushRow(row);
    const cursor = (await (await api("/api/sync/pull?since=0", { cookie })).json<PullResponse>()).cursor;

    expect((await upload(row.id, "%PDF")).status).toBe(204);

    const pulled = await (await api(`/api/sync/pull?since=${cursor}`, { cookie })).json<PullResponse>();
    expect(pulled.changes).toEqual([{ table: "attachments", row: { ...row, uploaded: 1 } }]);

    const res = await api(`/api/attachments/${row.id}`, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename*=UTF-8''${encodeURIComponent("確認信.pdf")}`);
    expect(await res.text()).toBe("%PDF");
  });

  it("keeps uploaded = 1 when the row is edited again later", async () => {
    const row = attachment();
    await pushRow(row);
    await upload(row.id, "%PDF");
    await pushRow({ ...row, updated_at: 2, filename: "renamed.pdf" });
    const stored = await env.DB.prepare("SELECT uploaded, filename FROM attachments WHERE id = ?").bind(row.id).first();
    expect(stored).toEqual({ uploaded: 1, filename: "renamed.pdf" });
  });

  it("rejects script-capable types at sync time", async () => {
    const res = await pushRow({ ...attachment(), content_type: "text/html" as Attachment["content_type"] });
    expect(res.rejected).toHaveLength(1);
  });

  it("rejects an upload whose type differs from the row, or that is too large", async () => {
    const row = attachment();
    await pushRow(row);
    expect((await upload(row.id, "<svg/>", "image/svg+xml")).status).toBe(415);
    expect((await upload(row.id, new Uint8Array(MAX_ATTACHMENT_BYTES + 1))).status).toBe(413);
    expect((await upload(row.id, "")).status).toBe(413);
  });

  it("refuses uploads before the row is synced, and files of other users", async () => {
    expect((await upload(crypto.randomUUID(), "%PDF")).status).toBe(404);

    const otherId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, 0)").bind(otherId, `o-${otherId}`).run();
    const other = `__Host-tp_session=${(await createSession(env.DB, env.SESSION_SECRET, otherId, undefined, Date.now())).cookieValue}`;
    const theirs = attachment();
    await pushRow(theirs, other);
    await upload(theirs.id, "%PDF", "application/pdf", other);

    expect((await api(`/api/attachments/${theirs.id}`, { cookie })).status).toBe(404);
    expect((await upload(theirs.id, "%EVIL")).status).toBe(404);
  });

  it("returns 404 until the file is uploaded", async () => {
    const row = attachment();
    await pushRow(row);
    expect((await api(`/api/attachments/${row.id}`, { cookie })).status).toBe(404);
  });

  it("deletes the R2 object when the attachment is deleted", async () => {
    const row = attachment();
    await pushRow(row);
    await upload(row.id, "%PDF");
    const key = (await env.DB.prepare("SELECT r2_key FROM attachments WHERE id = ?").bind(row.id).first<{ r2_key: string }>())?.r2_key ?? "";
    expect(await env.ATTACHMENTS.head(key)).not.toBeNull();

    await pushRow({ ...row, updated_at: 5, deleted: 1 });
    await expect.poll(async () => env.ATTACHMENTS.head(key)).toBeNull();
    expect((await api(`/api/attachments/${row.id}`, { cookie })).status).toBe(404);
  });
});
