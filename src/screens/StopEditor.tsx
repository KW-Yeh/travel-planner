import { useState, type SubmitEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { STOP_KINDS, type Stop, type StopKind } from "../../shared/schema";
import { describeDate, formatDuration, formatHhmm } from "../../shared/time";
import { deleteStop, saveStop, type Placement, type StopInput } from "../data/actions";
import { KIND_DEFAULT_STAY, KIND_LABEL, STAY_OPTIONS } from "../data/labels";
import { stopsOfDay, useTripBundle, type TripBundle } from "../data/queries";
import { dayTimeline } from "../data/summary";
import { selectDay } from "./TripLayout";

const KEEP = "keep";
const START = "start";
const END = "end";

function stayOptions(current: number): number[] {
  return STAY_OPTIONS.includes(current) ? STAY_OPTIONS : [...STAY_OPTIONS, current].sort((a, b) => a - b);
}

function Editor({ bundle, stop, initialDayId }: { bundle: TripBundle; stop: Stop | null; initialDayId: string | null }) {
  const navigate = useNavigate();
  const { trip } = bundle;
  const [name, setName] = useState(stop?.name ?? "");
  const [kind, setKind] = useState<StopKind>(stop?.kind ?? "sight");
  const [dayId, setDayId] = useState<string | null>(stop ? stop.day_id : initialDayId);
  const [placement, setPlacement] = useState(stop ? KEEP : END);
  const [arrivalMode, setArrivalMode] = useState(stop?.arrival_mode ?? "auto");
  const [fixedTime, setFixedTime] = useState(stop?.fixed_time ?? "12:00");
  const [stay, setStay] = useState(stop?.stay_minutes ?? KIND_DEFAULT_STAY.sight);
  const [stayTouched, setStayTouched] = useState(Boolean(stop));
  const [note, setNote] = useState(stop?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dayStops = stopsOfDay(bundle, dayId).filter((s) => s.id !== stop?.id);
  const sameDay = stop !== null && dayId === stop.day_id;
  const day = bundle.days.find((d) => d.id === dayId);
  const autoArrival = stop && day && sameDay ? dayTimeline(bundle, day).entries.find((e) => e.stop.id === stop.id)?.arrival : null;
  const back = `/trips/${trip.id}${dayId ? `?day=${dayId}` : ""}`;

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("請輸入地點名稱。");
      return;
    }
    const input: StopInput = {
      name: name.trim(),
      kind,
      arrival_mode: arrivalMode,
      fixed_time: arrivalMode === "fixed" ? fixedTime : null,
      stay_minutes: stay,
      note: note.trim() || null,
      place_id: stop?.place_id ?? null,
      address: stop?.address ?? null,
      lat: stop?.lat ?? null,
      lng: stop?.lng ?? null,
      place_fetched_at: stop?.place_fetched_at ?? null,
    };
    let where: Placement | "keep";
    if (placement === KEEP && sameDay) where = "keep";
    else if (placement === START) where = { dayId, at: "start" };
    else if (placement === END || placement === KEEP) where = { dayId, at: "end" };
    else where = { dayId, at: { after: placement } };
    await saveStop(trip.id, stop?.id ?? null, input, where);
    void navigate(back, { replace: true });
  }

  return (
    <div className="screen">
      <header className="topbar glass">
        <Link to={back} className="topbar-text-btn">
          取消
        </Link>
        <h1 className="topbar-center">{stop ? "編輯地點" : "新增地點"}</h1>
        <button type="submit" form="stop-form" className="topbar-text-btn strong">
          儲存
        </button>
      </header>
      <form id="stop-form" className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="field">
          <label htmlFor="stop-name" className="field-label">
            地點名稱
          </label>
          <input
            id="stop-name"
            className="input glass"
            value={name}
            maxLength={200}
            placeholder="例如 清水寺"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>

        <fieldset className="field">
          <legend>類型</legend>
          <div className="chips">
            {STOP_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  if (!stayTouched) setStay(KIND_DEFAULT_STAY[k]);
                }}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field-row">
          <div className="field">
            <label htmlFor="stop-day" className="field-label">
              日期
            </label>
            <select
              id="stop-day"
              className="select glass"
              value={dayId ?? ""}
              onChange={(e) => {
                setDayId(e.target.value || null);
                setPlacement(END);
              }}
            >
              {bundle.days.map((d, i) => {
                const date = describeDate(d.date);
                return (
                  <option key={d.id} value={d.id}>
                    Day {i + 1} · {date.md} {date.weekday}
                  </option>
                );
              })}
              <option value="">尚未排入</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="stop-after" className="field-label">
              排在
            </label>
            <select
              id="stop-after"
              className="select glass"
              value={placement}
              onChange={(e) => {
                setPlacement(e.target.value);
              }}
            >
              {stop && sameDay && <option value={KEEP}>目前位置</option>}
              <option value={START}>最前面</option>
              {dayStops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}之後
                </option>
              ))}
              <option value={END}>最後</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="stop-arrival" className="field-label">
              抵達時間
            </label>
            <select
              id="stop-arrival"
              className="select glass"
              value={arrivalMode}
              onChange={(e) => {
                setArrivalMode(e.target.value === "fixed" ? "fixed" : "auto");
              }}
            >
              <option value="auto">自動推算{autoArrival != null ? `（${formatHhmm(autoArrival)}）` : ""}</option>
              <option value="fixed">指定固定時間</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="stop-stay" className="field-label">
              停留時間
            </label>
            <select
              id="stop-stay"
              className="select glass"
              value={stay}
              onChange={(e) => {
                setStay(Number(e.target.value));
                setStayTouched(true);
              }}
            >
              {stayOptions(stay).map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "不停留" : formatDuration(m)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {arrivalMode === "fixed" && (
          <div className="field">
            <label htmlFor="stop-fixed" className="field-label">
              固定抵達時間（例如開場時間，後面的行程不會推擠它）
            </label>
            <input
              id="stop-fixed"
              type="time"
              className="input glass"
              value={fixedTime}
              onChange={(e) => {
                if (e.target.value) setFixedTime(e.target.value);
              }}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="stop-note" className="field-label">
            備註
          </label>
          <textarea
            id="stop-note"
            className="textarea glass"
            rows={2}
            maxLength={5000}
            placeholder="營業時間、想吃的東西、注意事項…"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        {stop &&
          (confirmDelete ? (
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                void deleteStop(stop).then(() => navigate(back, { replace: true }));
              }}
            >
              確定刪除「{stop.name}」與它的訂位
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              刪除地點
            </button>
          ))}
      </form>
    </div>
  );
}

export function StopEditor() {
  const { tripId, stopId } = useParams();
  const [params] = useSearchParams();
  const bundle = useTripBundle(tripId);
  if (bundle === undefined) return null;
  if (bundle === null) return <p className="empty">找不到這趟旅程。</p>;
  const stop = stopId ? (bundle.stops.find((s) => s.id === stopId) ?? null) : null;
  if (stopId && !stop) return <p className="empty">找不到這個地點，可能已被刪除。</p>;
  const initialDayId = selectDay(bundle, params.get("day"))?.id ?? null;
  return <Editor key={stop?.id ?? "new"} bundle={bundle} stop={stop} initialDayId={initialDayId} />;
}
