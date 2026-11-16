import { Hono } from "hono";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "../../shared/schema";
import { apiError } from "../http";
import type { AppEnv } from "../types";

type AttachmentRecord = { id: string; r2_key: string; content_type: string; filename: string; size: number; uploaded: number; deleted: number };

export const attachmentRoutes = new Hono<AppEnv>();

async function findOwn(db: D1Database, userId: string, id: string): Promise<AttachmentRecord | null> {
  return db
    .prepare("SELECT id, r2_key, content_type, filename, size, uploaded, deleted FROM attachments WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<AttachmentRecord>();
}

/** Upload the file for an attachment row that was already synced. */
attachmentRoutes.put("/:id", async (c) => {
  const { userId } = c.var.session;
  const row = await findOwn(c.env.DB, userId, c.req.param("id"));
  if (!row || row.deleted === 1) return apiError(c, 404, "not_found");

  const type = c.req.header("Content-Type")?.split(";")[0]?.trim() ?? "";
  if (type !== row.content_type || !(ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return apiError(c, 415, "unsupported_media_type");
  }
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES) return apiError(c, 413, "bad_request");

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MAX_ATTACHMENT_BYTES) return apiError(c, 413, "bad_request");

  await c.env.ATTACHMENTS.put(row.r2_key, body, { httpMetadata: { contentType: type } });
  // A new version makes other devices pull `uploaded = 1` and fetch the file.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO sync_counter (user_id, value) VALUES (?1, 1) ON CONFLICT (user_id) DO UPDATE SET value = value + 1",
    ).bind(userId),
    c.env.DB.prepare(
      "UPDATE attachments SET uploaded = 1, size = ?, version = (SELECT value FROM sync_counter WHERE user_id = ?) WHERE id = ? AND user_id = ?",
    ).bind(body.byteLength, userId, row.id, userId),
  ]);
  return c.body(null, 204);
});

attachmentRoutes.get("/:id", async (c) => {
  const { userId } = c.var.session;
  const row = await findOwn(c.env.DB, userId, c.req.param("id"));
  if (!row || row.deleted === 1 || row.uploaded === 0) return apiError(c, 404, "not_found");
  const object = await c.env.ATTACHMENTS.get(row.r2_key);
  if (!object) return apiError(c, 404, "not_found");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

/** Removes R2 objects of attachments that were just soft-deleted. */
export async function purgeDeletedAttachments(env: Env, userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { results } = await env.DB.prepare(
    `SELECT r2_key FROM attachments WHERE user_id = ? AND deleted = 1 AND id IN (${ids.map(() => "?").join(", ")})`,
  )
    .bind(userId, ...ids)
    .all<{ r2_key: string }>();
  if (results.length > 0) await env.ATTACHMENTS.delete(results.map((r) => r.r2_key));
}
