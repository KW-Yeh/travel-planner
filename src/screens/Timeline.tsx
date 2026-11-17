import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useMatch, useNavigate, useSearchParams } from "react-router";
import type { Leg, Reservation, Stop } from "../../shared/schema";
import { dayOffset, describeDate, formatDuration, formatHhmm } from "../../shared/time";
import { isDayOrigin, type Conflict, type Suggestion, type TimelineEntry } from "../../shared/timeline";
import { BackIcon, ChevronIcon, DownIcon, EditIcon, GripIcon, ModeIcon, PlusIcon, UpIcon, WarningIcon } from "../components/icons";
import { ensureLeg, moveStop, setDayDepart, setStay } from "../data/actions";
import { KIND_LABEL, MODE_SHORT } from "../data/labels";
import { stopsOfDay } from "../data/queries";
import { dayTimeline, tripDateText } from "../data/summary";
import { useTripContext } from "./TripLayout";
import { primaryLine, shownMode, type RouteStep } from "../../shared/routes";
import { useMapsConfig } from "../maps/google";
import { knownAlternatives, switchLegMode, useAutoRefreshLegs } from "../maps/routes";
import { dragScroll } from "../components/dragScroll";
import styles from "./Timeline.module.css";

function TimeText({ minutes, danger }: { minutes: number | null; danger?: boolean }) {
  if (minutes === null) {
    return (
      <span className={styles.time} aria-label="時間未定">
        --:--
      </span>
    );
  }
  const text = formatHhmm(minutes);
  const offset = dayOffset(minutes);
  return (
    <span key={`${text}+${offset}`} className={`${styles.time} fade-swap ${danger ? styles.danger : ""}`}>
      {text}
      {offset > 0 && <sup>+{offset}</sup>}
    </span>
  );
}

function legDetail(leg: Leg): string {
  if (leg.source === "manual") return "手動";
  if (!leg.steps) return "";
  try {
    return primaryLine(JSON.parse(leg.steps) as RouteStep[]);
  } catch {
    return "";
  }
}

function LegRow({ leg, tripId, daySearch, onCreate }: { leg: Leg | null | undefined; tripId: string; daySearch: string; onCreate: () => void }) {
  const content = (text: string, detail: string, mode: Leg["mode"]) => (
    <>
      <ModeIcon mode={mode} size={18} />
      <span className={styles.legText}>{text}</span>
      <span className={styles.legDetail}>{detail}</span>
      <ChevronIcon size={16} />
    </>
  );
  return (
    <div className={styles.legRow}>
      <span className={styles.rail} aria-hidden="true">
        <span />
      </span>
      {leg ? (
        <Link to={`/trips/${tripId}/legs/${leg.id}${daySearch}`} className={styles.leg}>
          {leg.minutes === null
            ? content("交通時間未定", "點此設定", leg.mode)
            : (() => {
                // A transit lookup that found no ride is shown as walking, not as transit.
                const mode = shownMode(leg);
                return content(`${MODE_SHORT[mode]} ${leg.minutes} 分`, mode === leg.mode ? legDetail(leg) : "不需搭車", mode);
              })()}
          {leg.note && <span className={styles.legNote}>{leg.note}</span>}
        </Link>
      ) : (
        <button type="button" className={styles.leg} onClick={onCreate}>
          {content("設定交通", "", "transit")}
        </button>
      )}
    </div>
  );
}

function conflictText(c: Conflict): string {
  return c.kind === "late_for_reservation"
    ? `預計比訂位時間晚 ${c.lateBy} 分抵達`
    : `排不進固定時間，預計晚 ${c.lateBy} 分抵達`;
}

function suggestionText(s: Suggestion, stops: Stop[]): string {
  if (s.kind === "shorten_stay") {
    const name = stops.find((x) => x.id === s.stopId)?.name ?? "前一站";
    return `${name}停留縮短為 ${formatDuration(s.stayMinutes)}`;
  }
  return `改用${MODE_SHORT[s.mode]}，省 ${s.savesMinutes} 分`;
}

function reservationLine(r: Reservation): string {
  const parts = [r.time ? `訂位 ${r.time}` : "訂位時間未填"];
  if (r.party_size) parts.push(`${r.party_size} 位`);
  if (r.code) parts.push(`代號 ${r.code}`);
  return parts.join(" · ");
}

type StopCardProps = {
  entry: TimelineEntry;
  index: number;
  reservations: Reservation[];
  stops: Stop[];
  onApply: (s: Suggestion) => void;
};

function StopCard({ entry, index, reservations, stops, onApply }: StopCardProps) {
  const { stop, departure, waitMinutes, conflicts } = entry;
  const sub: string[] = [];
  if (isDayOrigin(stop, index)) sub.push("起點 · 出發");
  else {
    if (index === 0) sub.push("起點");
    if (stop.arrival_mode === "fixed" && stop.fixed_time) sub.push(`固定 ${stop.fixed_time}`);
    if (waitMinutes > 0) sub.push(`等待 ${formatDuration(waitMinutes)}`);
    sub.push(stop.stay_minutes > 0 ? `停留 ${formatDuration(stop.stay_minutes)}` : "不停留");
    if (departure !== null && stop.stay_minutes > 0) sub.push(`${formatHhmm(departure)} 離開`);
  }
  return (
    <>
      <div className={styles.cardHead}>
        <h2>{stop.name}</h2>
        <span className={`badge badge-${stop.kind}`}>{KIND_LABEL[stop.kind]}</span>
      </div>
      <p className={styles.sub}>{sub.join(" · ")}</p>
      {reservations.map((r) => (
        <p key={r.id} className={styles.sub}>
          {reservationLine(r)}
        </p>
      ))}
      {conflicts.map((c, i) => (
        <div key={i} className={styles.conflictBox}>
          <p className={styles.conflictText}>
            <WarningIcon size={18} />
            {conflictText(c)}
          </p>
          {c.kind === "late_for_reservation" &&
            c.suggestions.map((s, j) => (
              <button
                key={j}
                type="button"
                className={`btn btn-danger ${styles.suggestion}`}
                onClick={(e) => {
                  e.preventDefault();
                  onApply(s);
                }}
              >
                {suggestionText(s, stops)}
              </button>
            ))}
        </div>
      ))}
    </>
  );
}

type Drag = { id: string; from: number; startY: number; dy: number; target: number; height: number };

/** `embedded`: the desktop shell already shows the trip's name and navigation. */
export function Timeline({ embedded = false }: { embedded?: boolean }) {
  const { bundle, day, search } = useTripContext();
  const { trip } = bundle;
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const [reorder, setReorder] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const openStopId = useMatch("/trips/:tripId/stops/:stopId")?.params.stopId;

  const stops = day ? stopsOfDay(bundle, day.id) : [];
  const unscheduled = stopsOfDay(bundle, null);
  const config = useMapsConfig();
  useAutoRefreshLegs(bundle, day, config?.routesEnabled ?? false);
  const timeline = day ? dayTimeline(bundle, day, knownAlternatives()) : null;
  const reservationsOf = (stopId: string) => bundle.reservations.filter((r) => r.stop_id === stopId);
  const daySearch = day ? `?day=${day.id}` : "";

  async function apply(s: Suggestion) {
    if (s.kind === "shorten_stay") {
      const stop = stops.find((x) => x.id === s.stopId);
      if (stop) await setStay(stop, s.stayMinutes);
    } else {
      const leg = bundle.legs.find((l) => l.id === s.legId);
      if (leg && !(await switchLegMode(leg, s.mode))) void navigate(`/trips/${trip.id}/legs/${leg.id}${daySearch}`);
    }
  }

  function onGripDown(e: ReactPointerEvent, stop: Stop, index: number) {
    const el = rowRefs.current.get(stop.id);
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: stop.id, from: index, startY: e.clientY, dy: 0, target: index, height: el.offsetHeight + 6 });
  }

  function onGripMove(e: ReactPointerEvent) {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    let target = drag.from;
    stops.forEach((s, i) => {
      if (s.id === drag.id) return;
      const rect = rowRefs.current.get(s.id)?.getBoundingClientRect();
      if (!rect) return;
      const mid = rect.top + rect.height / 2;
      if (i > drag.from && e.clientY > mid) target = Math.max(target, i);
      if (i < drag.from && e.clientY < mid) target = Math.min(target, i);
    });
    setDrag({ ...drag, dy, target });
  }

  function onGripUp() {
    if (!drag) return;
    const stop = stops.find((s) => s.id === drag.id);
    if (stop && drag.target !== drag.from) void moveStop(stop, drag.target);
    setDrag(null);
  }

  function shiftFor(index: number, id: string): number {
    if (!drag || id === drag.id) return 0;
    if (drag.target > drag.from && index > drag.from && index <= drag.target) return -drag.height;
    if (drag.target < drag.from && index < drag.from && index >= drag.target) return drag.height;
    return 0;
  }

  return (
    <div className="screen">
      {!embedded && (
        <header className="topbar glass">
          <Link to="/" className="icon-btn" aria-label="返回旅程列表">
            <BackIcon />
          </Link>
          <div className="topbar-titles">
            <h1>{trip.name}</h1>
            <p>{tripDateText(trip)}</p>
          </div>
          <Link to={`/trips/${trip.id}/edit`} className="icon-btn" aria-label="編輯旅程">
            <EditIcon />
          </Link>
        </header>
      )}

      {bundle.days.length > 0 && (
        <div ref={dragScroll} className={`${styles.days} glass`} role="group" aria-label="選擇日期">
          {bundle.days.map((d, i) => {
            const date = describeDate(d.date);
            const selected = d.id === day?.id;
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={selected}
                className={styles.day}
                onClick={() => {
                  setParams({ day: d.id }, { replace: true });
                }}
              >
                <span className={styles.dayNum}>Day {i + 1}</span>
                <span className={styles.dayDate}>
                  {date.md} {date.weekday}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {day && timeline && (
        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <p>
              {stops.length} 個地點
              {timeline.travelMinutes > 0 && ` · 交通共 ${formatDuration(timeline.travelMinutes)}`}
            </p>
            <Link to={`/trips/${trip.id}/stops/new${daySearch}`} className="btn btn-primary btn-pill">
              <PlusIcon size={16} />
              新增地點
            </Link>
          </div>
          <div className={styles.summaryRow}>
            <label className={styles.depart}>
              <span>當日出發</span>
              <input
                type="time"
                value={day.depart_time}
                aria-label="當日出發時間"
                onChange={(e) => {
                  if (e.target.value) void setDayDepart(day, e.target.value);
                }}
              />
            </label>
            {stops.length > 1 && (
              <button
                type="button"
                className="btn btn-quiet btn-pill"
                aria-pressed={reorder}
                onClick={() => {
                  setReorder(!reorder);
                }}
              >
                {reorder ? "完成" : "排序"}
              </button>
            )}
          </div>
        </div>
      )}

      <main className={styles.main}>
        {!day && (
          <div className="empty">
            <p>這趟旅程還沒有日期。</p>
            <p>
              <Link to={`/trips/${trip.id}/edit`}>設定日期</Link> 後就能排每天的行程；也可以先
              <Link to={`/trips/${trip.id}/stops/new`}>新增想去的地點</Link>。
            </p>
          </div>
        )}
        {day && stops.length === 0 && <p className="empty">這天還沒有地點。按「新增地點」開始。</p>}

        {timeline?.entries.map((entry, index) => {
          const { stop } = entry;
          const danger = entry.conflicts.length > 0;
          const dragging = drag?.id === stop.id;
          const card = (
            <StopCard
              entry={entry}
              index={index}
              reservations={reservationsOf(stop.id)}
              stops={stops}
              onApply={(s) => void apply(s)}
            />
          );
          return (
            <div key={stop.id} className={styles.block}>
              {index > 0 && !reorder && (
                <LegRow
                  leg={entry.legIn}
                  tripId={trip.id}
                  daySearch={daySearch}
                  onCreate={() => {
                    const prev = stops[index - 1];
                    if (prev) void ensureLeg(trip.id, prev, stop).then((leg) => navigate(`/trips/${trip.id}/legs/${leg.id}${daySearch}`));
                  }}
                />
              )}
              <div
                ref={(el) => {
                  if (el) rowRefs.current.set(stop.id, el);
                  else rowRefs.current.delete(stop.id);
                }}
                className={`${styles.stopRow} ${dragging ? styles.dragging : ""}`}
                style={{ transform: dragging ? `translateY(${drag.dy}px) scale(1.02)` : `translateY(${shiftFor(index, stop.id)}px)` }}
              >
                <TimeText minutes={entry.arrival} danger={danger} />
                {reorder ? (
                  <div className={`${styles.card} card glass`}>
                    <div className={styles.reorderRow}>
                      <span className={styles.reorderName}>{stop.name}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`${stop.name} 上移`}
                        disabled={index === 0}
                        onClick={() => void moveStop(stop, index - 1)}
                      >
                        <UpIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`${stop.name} 下移`}
                        disabled={index === stops.length - 1}
                        onClick={() => void moveStop(stop, index + 1)}
                      >
                        <DownIcon />
                      </button>
                      <span
                        className={styles.grip}
                        aria-hidden="true"
                        onPointerDown={(e) => {
                          onGripDown(e, stop, index);
                        }}
                        onPointerMove={onGripMove}
                        onPointerUp={onGripUp}
                        onPointerCancel={() => {
                          setDrag(null);
                        }}
                      >
                        <GripIcon />
                      </span>
                    </div>
                  </div>
                ) : (
                  <Link
                    to={`/trips/${trip.id}/stops/${stop.id}${daySearch}`}
                    aria-current={openStopId === stop.id ? "page" : undefined}
                    className={`${styles.card} card card-link glass ${danger ? styles.cardDanger : ""}`}
                  >
                    {card}
                  </Link>
                )}
              </div>
            </div>
          );
        })}

        {unscheduled.length > 0 && (
          <section className={styles.unscheduled} aria-labelledby="unscheduled-title">
            <h2 id="unscheduled-title" className="section-title">
              尚未排入（{unscheduled.length}）
            </h2>
            {unscheduled.map((stop) => (
              <Link
                key={stop.id}
                to={`/trips/${trip.id}/stops/${stop.id}${search}`}
                className={`${styles.card} card card-link glass`}
              >
                <div className={styles.cardHead}>
                  <h2>{stop.name}</h2>
                  <span className={`badge badge-${stop.kind}`}>{KIND_LABEL[stop.kind]}</span>
                </div>
              </Link>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
