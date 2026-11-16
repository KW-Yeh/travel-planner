import { useState } from "react";
import { Link } from "react-router";
import type { Attachment, Day, Reservation, ReservationStatus, Stop } from "../../shared/schema";
import { describeDate, formatHhmm, parseHhmm } from "../../shared/time";
import { CopyIcon, FileIcon, PlusIcon, WarningIcon } from "../components/icons";
import { openAttachment, safeUrl } from "../data/bookings";
import { KIND_LABEL, STATUS_LABEL } from "../data/labels";
import type { TripBundle } from "../data/queries";
import { dayTimeline } from "../data/summary";
import { useTripContext } from "./TripLayout";
import styles from "./Bookings.module.css";

const STATUS_BADGE: Record<ReservationStatus, string> = {
  confirmed: "badge-ok",
  pending: "badge-warn",
  payment_due: "badge-danger",
};

type Item = { reservation: Reservation; stop: Stop; files: Attachment[]; late: { arrival: number; lateBy: number } | null };
type Group = { key: string; title: string; day: Day | null; items: Item[] };

function groupBookings(bundle: TripBundle): Group[] {
  const stopById = new Map(bundle.stops.map((s) => [s.id, s]));
  const lateByReservation = new Map<string, { arrival: number; lateBy: number }>();
  for (const day of bundle.days) {
    for (const entry of dayTimeline(bundle, day).entries) {
      for (const c of entry.conflicts) {
        if (c.kind === "late_for_reservation") {
          const time = bundle.reservations.find((r) => r.id === c.reservationId)?.time;
          if (time) lateByReservation.set(c.reservationId, { arrival: parseHhmm(time) + c.lateBy, lateBy: c.lateBy });
        }
      }
    }
  }
  const groups: Group[] = [
    ...bundle.days.map((day, i) => {
      const d = describeDate(day.date);
      return { key: day.id, title: `Day ${i + 1} · ${d.md}（${d.weekday}）`, day, items: [] as Item[] };
    }),
    { key: "none", title: "尚未排入", day: null, items: [] },
  ];
  for (const reservation of bundle.reservations) {
    const stop = stopById.get(reservation.stop_id);
    if (!stop) continue;
    const group = groups.find((g) => (g.day?.id ?? null) === stop.day_id);
    group?.items.push({
      reservation,
      stop,
      files: bundle.attachments.filter((a) => a.reservation_id === reservation.id),
      late: lateByReservation.get(reservation.id) ?? null,
    });
  }
  for (const g of groups) g.items.sort((a, b) => (a.reservation.time ?? "99").localeCompare(b.reservation.time ?? "99"));
  return groups.filter((g) => g.items.length > 0);
}

function BookingCard({ item, tripId }: { item: Item; tripId: string }) {
  const { reservation: r, stop, files, late } = item;
  const [notice, setNotice] = useState<string | null>(null);
  const url = r.url ? safeUrl(r.url) : null;
  const meta = [r.time ?? "時間未填", r.party_size ? `${r.party_size} 位` : null, KIND_LABEL[stop.kind]].filter(Boolean).join(" · ");
  const dayQuery = stop.day_id ? `?day=${stop.day_id}` : "";

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setNotice("已複製訂位代號");
    } catch {
      setNotice("無法複製，請長按代號手動複製");
    }
  }

  return (
    <article className={`${styles.card} card glass`}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <h3>{stop.name}</h3>
          <p>{meta}</p>
        </div>
        <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
      </div>

      {r.code && (
        <div className={styles.code}>
          <span className={styles.codeLabel}>訂位代號</span>
          <span className={styles.codeValue}>{r.code}</span>
          <button type="button" className="icon-btn" aria-label="複製訂位代號" onClick={() => void copy(r.code ?? "")}>
            <CopyIcon size={20} />
          </button>
        </div>
      )}
      <p className={styles.notice} role="status" aria-live="polite">
        {notice}
      </p>

      {late && (
        <p className={styles.late}>
          <WarningIcon size={16} />
          目前行程預計 {formatHhmm(late.arrival)} 抵達，晚 {late.lateBy} 分
        </p>
      )}

      {(files.length > 0 || url) && (
        <div className={styles.actions}>
          {files.map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                void openAttachment(f).then((ok) => {
                  if (!ok) setNotice("這個附件還沒下載到這台裝置，連線後再試。");
                });
              }}
            >
              <FileIcon size={16} />
              {f.filename}
            </button>
          ))}
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-quiet">
              開啟訂位連結
            </a>
          )}
        </div>
      )}

      <div className={styles.links}>
        <Link to={`/trips/${tripId}${dayQuery}`}>在行程中查看</Link>
        <Link to={`/trips/${tripId}/stops/${stop.id}${dayQuery}`}>{r.time ? "編輯訂位" : "補上時間與票券"}</Link>
      </div>
    </article>
  );
}

export function Bookings() {
  const { bundle, day } = useTripContext();
  const groups = groupBookings(bundle);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const dayQuery = day ? `&day=${day.id}` : "";

  return (
    <div className="screen">
      <header className={`topbar glass ${styles.header}`}>
        <div className="topbar-titles">
          <h1>訂位與票券</h1>
          <p>
            {bundle.trip.name} · 共 {count} 筆
          </p>
        </div>
        <Link
          to={`/trips/${bundle.trip.id}/stops/new?booking=1${dayQuery}`}
          className={`icon-btn ${styles.add}`}
          aria-label="新增訂位"
        >
          <PlusIcon size={20} />
        </Link>
      </header>
      <main className={styles.main}>
        {count === 0 && <p className="empty">還沒有訂位。在地點裡勾選「有訂位或票券」，或按右上角新增。</p>}
        {groups.map((g) => (
          <section key={g.key} className={styles.group} aria-label={g.title}>
            <h2 className="section-title">{g.title}</h2>
            {g.items.map((item) => (
              <BookingCard key={item.reservation.id} item={item} tripId={bundle.trip.id} />
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
