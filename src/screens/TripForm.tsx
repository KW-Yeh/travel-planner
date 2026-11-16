import { useState, type SubmitEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Trip } from "../../shared/schema";
import { createTrip, deleteTrip, deviceTimeZone, updateTrip, type TripInput } from "../data/actions";
import { useTripBundle } from "../data/queries";

const MAX_DAYS = 60;

function timeZones(current: string): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes(current) ? all : [current, ...all];
}

export function validateTrip(input: TripInput): string | null {
  if (!input.name.trim()) return "請輸入旅程名稱。";
  if (Boolean(input.start_date) !== Boolean(input.end_date)) return "請同時填寫開始與結束日期，或兩者都留空。";
  if (input.start_date && input.end_date) {
    if (input.end_date < input.start_date) return "結束日期不能早於開始日期。";
    const days = (Date.parse(input.end_date) - Date.parse(input.start_date)) / 86_400_000 + 1;
    if (days > MAX_DAYS) return `一趟旅程最多 ${MAX_DAYS} 天。`;
  }
  if (!Number.isInteger(input.party_size) || input.party_size < 1 || input.party_size > 99) return "人數需介於 1 到 99。";
  return null;
}

function Form({ trip }: { trip: Trip | null }) {
  const navigate = useNavigate();
  const [name, setName] = useState(trip?.name ?? "");
  const [start, setStart] = useState(trip?.start_date ?? "");
  const [end, setEnd] = useState(trip?.end_date ?? "");
  const [party, setParty] = useState(String(trip?.party_size ?? 2));
  const [timeZone, setTimeZone] = useState(trip?.time_zone ?? deviceTimeZone());
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: TripInput = {
      name: name.trim(),
      start_date: start || null,
      end_date: end || null,
      party_size: Number(party),
      time_zone: timeZone,
    };
    const problem = validateTrip(input);
    if (problem) {
      setError(problem);
      return;
    }
    if (trip) {
      await updateTrip(trip.id, input);
      void navigate(`/trips/${trip.id}`, { replace: true });
    } else {
      const id = await createTrip(input);
      void navigate(`/trips/${id}`, { replace: true });
    }
  }

  return (
    <div className="screen">
      <header className="topbar glass">
        <Link to={trip ? `/trips/${trip.id}` : "/"} className="topbar-text-btn">
          取消
        </Link>
        <h1 className="topbar-center">{trip ? "編輯旅程" : "建立旅程"}</h1>
        <button type="submit" form="trip-form" className="topbar-text-btn strong">
          儲存
        </button>
      </header>
      <form id="trip-form" className="form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <div className="field">
          <label htmlFor="trip-name" className="field-label">
            旅程名稱
          </label>
          <input
            id="trip-name"
            className="input glass"
            value={name}
            maxLength={200}
            placeholder="例如 京都賞櫻 3 日"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="trip-start" className="field-label">
              開始日期
            </label>
            <input
              id="trip-start"
              type="date"
              className="input glass"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (!end || e.target.value > end) setEnd(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="trip-end" className="field-label">
              結束日期
            </label>
            <input
              id="trip-end"
              type="date"
              className="input glass"
              value={end}
              min={start || undefined}
              onChange={(e) => {
                setEnd(e.target.value);
              }}
            />
          </div>
        </div>
        <p className="hint">日期可以先留空，之後再補。縮短日期時，被移除那幾天的地點會移到「尚未排入」。</p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="trip-party" className="field-label">
              人數
            </label>
            <input
              id="trip-party"
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              className="input glass"
              value={party}
              onChange={(e) => {
                setParty(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="trip-tz" className="field-label">
              時區
            </label>
            <select
              id="trip-tz"
              className="select glass"
              value={timeZone}
              onChange={(e) => {
                setTimeZone(e.target.value);
              }}
            >
              {timeZones(timeZone).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {trip &&
          (confirmDelete ? (
            <div className="field">
              <p className="error-text" role="alert">
                刪除後，所有裝置上的這趟旅程都會消失。
              </p>
              <button
                type="button"
                className="btn btn-danger btn-block"
                onClick={() => {
                  void deleteTrip(trip.id).then(() => navigate("/", { replace: true }));
                }}
              >
                確定刪除「{trip.name}」
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={() => {
                setConfirmDelete(true);
              }}
            >
              刪除旅程
            </button>
          ))}
      </form>
    </div>
  );
}

export function TripForm() {
  const { tripId } = useParams();
  const bundle = useTripBundle(tripId);
  if (tripId && bundle === undefined) return null;
  if (tripId && bundle === null) return <p className="empty">找不到這趟旅程。</p>;
  return <Form trip={bundle?.trip ?? null} key={bundle?.trip.id ?? "new"} />;
}
