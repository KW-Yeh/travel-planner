import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { TravelDB } from "../db/db";
import { newId } from "../db/ids";
import { saveBooking, safeUrl, type PendingFile } from "./bookings";

const databases: TravelDB[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
function freshDb() {
  const d = new TravelDB(`bookings-${newId()}`);
  databases.push(d);
  return d;
}

const file = (name: string): PendingFile => ({
  id: newId(),
  filename: name,
  contentType: "application/pdf",
  blob: new Blob(["%PDF"], { type: "application/pdf" }),
});

const input = { time: "13:30", party_size: 2, code: "KY-2048", url: null, status: "confirmed" as const };

describe("safeUrl", () => {
  it.each([
    ["https://example.com/booking?id=1", "https://example.com/booking?id=1"],
    ["  http://example.com  ", "http://example.com/"],
    ["javascript:alert(1)", null],
    ["data:text/html,<b>x</b>", null],
    ["not a url", null],
  ])("%s → %s", (value, expected) => {
    expect(safeUrl(value)).toBe(expected);
  });
});

describe("saveBooking", () => {
  it("creates the reservation with its files, stores the files locally, and queues everything", async () => {
    const d = freshDb();
    const trip = newId();
    const stop = newId();
    const pdf = file("confirm.pdf");
    await saveBooking(trip, stop, null, input, [pdf], [], d);

    const [res] = await d.reservations.toArray();
    expect(res).toMatchObject({ trip_id: trip, stop_id: stop, code: "KY-2048", deleted: 0 });
    const [att] = await d.attachments.toArray();
    expect(att).toMatchObject({ id: pdf.id, reservation_id: res?.id, size: 4, uploaded: 0 });
    expect(await d.blobs.get(pdf.id)).toBeDefined();
    expect(await d.outbox.count()).toBe(2);
  });

  it("removes single files, and the whole booking with all files", async () => {
    const d = freshDb();
    const trip = newId();
    const stop = newId();
    const a = file("a.pdf");
    const b = file("b.pdf");
    await saveBooking(trip, stop, null, input, [a, b], [], d);
    const res = (await d.reservations.toArray())[0];
    if (!res) throw new Error("fixture");
    const attA = await d.attachments.get(a.id);
    if (!attA) throw new Error("fixture");

    await saveBooking(trip, stop, res, input, [], [attA], d);
    expect((await d.attachments.get(a.id))?.deleted).toBe(1);
    expect(await d.blobs.get(a.id)).toBeUndefined();
    expect(await d.blobs.get(b.id)).toBeDefined();

    await saveBooking(trip, stop, res, null, [], [], d);
    expect((await d.reservations.get(res.id))?.deleted).toBe(1);
    expect((await d.attachments.get(b.id))?.deleted).toBe(1);
    expect(await d.blobs.count()).toBe(0);
  });
});
