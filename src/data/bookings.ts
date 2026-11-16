import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, type Attachment, type Reservation, type ReservationStatus } from "../../shared/schema";
import { db, type TravelDB } from "../db/db";
import { newId } from "../db/ids";
import { writeRows, type DraftChange } from "../db/mutate";

export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];
export type PendingFile = { id: string; filename: string; contentType: AttachmentType; blob: Blob };

export type ReservationInput = {
  time: string | null;
  party_size: number | null;
  code: string | null;
  url: string | null;
  status: ReservationStatus;
};

/** Only web links open from a booking; anything else (javascript:, data:, file:) is refused. */
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function isAttachmentType(type: string): type is AttachmentType {
  return (ATTACHMENT_TYPES as readonly string[]).includes(type);
}

const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.85;

/** Downscales large photos and screenshots; PDFs and small images are kept as they are. */
export async function prepareFile(file: File): Promise<PendingFile> {
  if (!isAttachmentType(file.type)) throw new Error("只能附上 JPEG、PNG、WebP 圖片或 PDF。");
  let blob: Blob = file;
  let contentType: AttachmentType = file.type;
  let filename = file.name || "附件";

  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale < 1 || file.size > 1.5 * 1024 * 1024) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
      });
      if (jpeg && jpeg.size < file.size) {
        blob = jpeg;
        contentType = "image/jpeg";
        filename = filename.replace(/\.[^.]+$/, "") + ".jpg";
      }
    }
    bitmap.close();
  }
  if (blob.size > MAX_ATTACHMENT_BYTES) throw new Error("檔案超過 10 MB，請改用較小的檔案。");
  return { id: newId(), filename, contentType, blob };
}

/**
 * Saves (or removes) a stop's booking together with its file changes. Files are stored
 * locally right away; the sync engine uploads them once their rows reach the server.
 */
export async function saveBooking(
  tripId: string,
  stopId: string,
  existing: Reservation | null,
  input: ReservationInput | null,
  added: PendingFile[],
  removed: Attachment[],
  database: TravelDB = db,
): Promise<void> {
  const changes: DraftChange[] = [];
  const attachments = existing ? await database.attachments.where("reservation_id").equals(existing.id).toArray() : [];

  if (!input) {
    if (existing) changes.push({ table: "reservations", row: { ...existing, deleted: 1 } });
    for (const a of attachments) if (a.deleted === 0) changes.push({ table: "attachments", row: { ...a, deleted: 1 } });
  } else {
    const id = existing?.id ?? newId();
    changes.push({ table: "reservations", row: { ...(existing ?? {}), ...input, id, trip_id: tripId, stop_id: stopId } });
    for (const a of removed) changes.push({ table: "attachments", row: { ...a, deleted: 1 } });
    for (const f of added) {
      changes.push({
        table: "attachments",
        row: { id: f.id, reservation_id: id, filename: f.filename, content_type: f.contentType, size: f.blob.size, uploaded: 0 },
      });
    }
  }

  await database.transaction("rw", database.blobs, async () => {
    for (const f of added) if (input) await database.blobs.put({ id: f.id, blob: f.blob });
  });
  await writeRows(changes, database);
  const gone = input ? removed.map((a) => a.id) : attachments.map((a) => a.id);
  await database.blobs.bulkDelete(gone);
}

/** Opens an attachment from the local copy, or from the server when it was not downloaded yet. */
export async function openAttachment(att: Attachment, database: TravelDB = db): Promise<boolean> {
  const local = await database.blobs.get(att.id);
  if (local) {
    const url = URL.createObjectURL(local.blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
    return true;
  }
  if (att.uploaded === 1 && navigator.onLine) {
    window.open(`/api/attachments/${att.id}`, "_blank", "noopener");
    return true;
  }
  return false;
}
