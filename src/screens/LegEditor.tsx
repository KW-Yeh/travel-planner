import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LEG_MODES, type Leg, type LegMode } from "../../shared/schema";
import { formatHhmm } from "../../shared/time";
import { BackIcon, ModeIcon } from "../components/icons";
import { setLegManual } from "../data/actions";
import { MODE_LABEL } from "../data/labels";
import { useTripBundle, type TripBundle } from "../data/queries";
import { dayTimeline } from "../data/summary";
import styles from "./LegEditor.module.css";

function Editor({ bundle, leg }: { bundle: TripBundle; leg: Leg }) {
  const navigate = useNavigate();
  const from = bundle.stops.find((s) => s.id === leg.from_stop_id);
  const to = bundle.stops.find((s) => s.id === leg.to_stop_id);
  const day = bundle.days.find((d) => d.id === to?.day_id);
  const entries = day ? dayTimeline(bundle, day).entries : [];
  const departure = entries.find((e) => e.stop.id === leg.from_stop_id)?.departure ?? null;

  const [mode, setMode] = useState<LegMode>(leg.mode);
  const [minutes, setMinutes] = useState(leg.minutes === null ? "" : String(leg.minutes));
  const [error, setError] = useState<string | null>(null);
  const back = `/trips/${bundle.trip.id}${day ? `?day=${day.id}` : ""}`;
  const parsed = Number(minutes);
  const valid = minutes !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 48 * 60;

  async function apply() {
    if (!valid) {
      setError("請輸入 0 到 2880 之間的整數分鐘。");
      return;
    }
    await setLegManual(leg, mode, parsed);
    void navigate(back, { replace: true });
  }

  return (
    <div className="screen">
      <header className="topbar glass">
        <Link to={back} className="icon-btn" aria-label="返回行程">
          <BackIcon />
        </Link>
        <div className="topbar-titles">
          <h1>交通方式</h1>
          <p>
            {from?.name ?? "?"} → {to?.name ?? "?"}
          </p>
        </div>
      </header>

      <main className="form">
        {departure !== null && (
          <p className={`${styles.when} card glass`}>
            {formatHhmm(departure)} 出發
            {valid && ` → ${formatHhmm(departure + parsed)} 抵達`}
          </p>
        )}

        <fieldset className="field">
          <legend>交通方式</legend>
          <div className={styles.modes}>
            {LEG_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={styles.mode}
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                }}
              >
                <ModeIcon mode={m} size={18} />
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="leg-minutes" className="field-label">
            交通時間（分鐘）
          </label>
          <input
            id="leg-minutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={2880}
            className="input glass"
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setError(null);
            }}
          />
          <p className="hint">
            {leg.source === "manual" ? "目前為手動輸入的時間。" : "查不到路線或想自己估時使用；手動輸入的時間不會被自動重查覆蓋。"}
          </p>
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </main>

      <div className={`${styles.actions} glass`}>
        <button type="button" className="btn btn-primary btn-block" onClick={() => void apply()}>
          套用
        </button>
      </div>
    </div>
  );
}

export function LegEditor() {
  const { tripId, legId } = useParams();
  const bundle = useTripBundle(tripId);
  if (bundle === undefined) return null;
  const leg = bundle?.legs.find((l) => l.id === legId);
  if (!bundle || !leg) return <p className="empty">找不到這段交通，可能已被刪除。</p>;
  return <Editor key={leg.id} bundle={bundle} leg={leg} />;
}
