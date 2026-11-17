import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { directionsUrl } from "../../shared/maps-links";
import { isWalkOnly, type CompareResponse, type Endpoint, type RouteResult, type RouteStep } from "../../shared/routes";
import { LEG_MODES, type Leg, type LegMode, type Stop } from "../../shared/schema";
import { formatHhmm, zonedToEpoch } from "../../shared/time";
import { parseTrack } from "../../shared/track";
import { BackIcon, ModeIcon } from "../components/icons";
import { setLegManual, setLegNote } from "../data/actions";
import { MODE_LABEL } from "../data/labels";
import { useTripBundle, type TripBundle } from "../data/queries";
import { dayTimeline } from "../data/summary";
import { useMapsConfig, useOnline } from "../maps/google";
import { applyGoogleResult, compareRoutes, endpointOf, rememberComparison } from "../maps/routes";
import styles from "./LegEditor.module.css";

type Lookup =
  | { state: "idle" | "loading" }
  | { state: "done"; res: CompareResponse }
  | { state: "unavailable"; reason: string };

function resultLabel(r: RouteResult | undefined, mode: LegMode): string {
  if (!r) return "—";
  switch (r.status) {
    case "ok":
      // A transit lookup that found no ride: say so instead of passing walking off as transit.
      return mode === "transit" && isWalkOnly(r.steps) ? `步行 ${r.minutes} 分` : `${r.minutes} 分`;
    case "no_route":
      return "查無路線";
    case "out_of_range":
      return "出發前 100 天內可查";
    case "not_configured":
      return "未設定金鑰";
    case "error":
      return "查詢失敗";
  }
}

function StepList({ steps, departure }: { steps: RouteStep[]; departure: number | null }) {
  const startOf = (i: number) => (departure === null ? null : departure + steps.slice(0, i).reduce((sum, s) => sum + s.minutes, 0));
  return (
    <ol className={styles.steps}>
      {steps.map((step, i) => {
        const at = startOf(i);
        return (
          <li key={i}>
            <span className={styles.stepTime}>{at === null ? "" : formatHhmm(at)}</span>
            {step.kind === "transit" ? (
              <span className={styles.stepBody}>
                <strong>
                  {step.color && <span className={styles.lineDot} style={{ background: step.color }} aria-hidden="true" />}
                  {step.line}
                  {step.headsign ? ` 往${step.headsign}` : ""}
                </strong>
                <span>
                  {[
                    step.stops !== null ? `${step.stops} 站` : null,
                    step.to ? `${step.to}下車` : null,
                    step.exit ? `出口：${step.exit}` : null,
                  ]
                    .filter(Boolean)
                    .join("，")}
                </span>
              </span>
            ) : (
              <span className={styles.stepBody}>
                {step.kind === "walk" ? "步行" : step.mode === "WAIT" ? "候車" : MODE_LABEL.drive}
              </span>
            )}
            <span className={styles.stepMinutes}>{step.minutes} 分</span>
          </li>
        );
      })}
    </ol>
  );
}

function Editor({ bundle, leg, from, to }: { bundle: TripBundle; leg: Leg; from: Stop; to: Stop }) {
  const navigate = useNavigate();
  const config = useMapsConfig();
  const online = useOnline();
  const day = bundle.days.find((d) => d.id === to.day_id);
  const departure = day ? (dayTimeline(bundle, day).entries.find((e) => e.stop.id === from.id)?.departure ?? null) : null;
  const departAt = day && departure !== null ? zonedToEpoch(day.date, departure, bundle.trip.time_zone) : null;
  const origin = endpointOf(from);
  const destination = endpointOf(to);

  const [mode, setMode] = useState<LegMode>(leg.mode);
  const [manual, setManual] = useState(leg.source === "manual");
  const [minutes, setMinutes] = useState(leg.minutes === null ? "" : String(leg.minutes));
  const [fetched, setFetched] = useState<{ key: string; res: CompareResponse | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(leg.note ?? "");
  const back = `/trips/${bundle.trip.id}${day ? `?day=${day.id}` : ""}`;

  let unavailable: string | null = null;
  if (config && !config.routesEnabled) unavailable = "尚未設定 Google 路線金鑰，請手動輸入交通時間。";
  else if (!online) unavailable = "離線中，無法查詢路線；顯示的是最後一次算好的時間。";
  else if (!origin || !destination) unavailable = "其中一站沒有座標。請在地點裡用搜尋選取，或手動輸入時間。";
  const canLookup = Boolean(config) && unavailable === null;

  // Everything the lookup depends on, as one value: live-query refreshes that change nothing
  // relevant produce the same string and do not trigger another (billed) request.
  const requestKey = JSON.stringify({ origin, destination, departAt });
  useEffect(() => {
    if (!canLookup) return;
    const req = JSON.parse(requestKey) as { origin: Endpoint; destination: Endpoint; departAt: number | null };
    let cancelled = false;
    compareRoutes(req)
      .then((res) => {
        rememberComparison(leg.id, res, req.departAt);
        if (!cancelled) setFetched({ key: requestKey, res });
      })
      .catch(() => {
        if (!cancelled) setFetched({ key: requestKey, res: null });
      });
    return () => {
      cancelled = true;
    };
  }, [canLookup, requestKey, leg.id]);

  const [refreshing, setRefreshing] = useState(false);
  // Asks the provider again for this pair's transit route, bypassing the server cache.
  async function refreshTransit() {
    const req = JSON.parse(requestKey) as { origin: Endpoint; destination: Endpoint; departAt: number | null };
    setRefreshing(true);
    setError(null);
    try {
      const res = await compareRoutes({ ...req, modes: ["transit"], refresh: true });
      setFetched((prev) => {
        const merged: CompareResponse = { results: { ...(prev?.key === requestKey ? prev.res?.results : {}), ...res.results } };
        rememberComparison(leg.id, merged, req.departAt);
        return { key: requestKey, res: merged };
      });
    } catch {
      setError("重新查詢失敗，請稍後再試。");
    } finally {
      setRefreshing(false);
    }
  }

  const current = fetched?.key === requestKey ? fetched : null;
  const lookup: Lookup = !canLookup
    ? unavailable
      ? { state: "unavailable", reason: unavailable }
      : { state: "idle" }
    : !current
      ? { state: "loading" }
      : current.res
        ? { state: "done", res: current.res }
        : { state: "unavailable", reason: "查詢路線失敗，可以稍後再試或手動輸入。" };

  // Without a usable Google lookup the only way to set a time is by hand.
  const isManual = manual || lookup.state === "unavailable";
  const selected = lookup.state === "done" ? lookup.res.results[mode] : undefined;
  const googleOk = selected?.status === "ok" ? selected : null;
  const shownMinutes = isManual ? (minutes === "" ? null : Number(minutes)) : (googleOk?.minutes ?? (leg.mode === mode ? leg.minutes : null));
  const parsed = Number(minutes);
  const manualValid = minutes !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 48 * 60;

  async function apply() {
    const trimmed = note.trim();
    const edited: Leg = { ...leg, note: trimmed === "" ? null : trimmed };
    if (isManual) {
      if (!manualValid) {
        setError("請輸入 0 到 2880 之間的整數分鐘。");
        return;
      }
      await setLegManual(edited, mode, parsed);
    } else if (googleOk) {
      await applyGoogleResult(edited, mode, googleOk, departAt);
    } else if (leg.source === "google" && leg.mode === mode && leg.minutes !== null) {
      // Keep the stored result; only the note may have changed.
      if (edited.note !== leg.note) await setLegNote(leg, edited.note);
    } else {
      setError("這個方式目前沒有可用的路線，請改用手動輸入。");
      return;
    }
    void navigate(back, { replace: true });
  }

  const storedSteps: RouteStep[] = (() => {
    if (leg.mode !== mode || !leg.steps) return [];
    try {
      return JSON.parse(leg.steps) as RouteStep[];
    } catch {
      return [];
    }
  })();
  const steps = googleOk?.steps ?? (isManual ? [] : storedSteps);
  const fromNavitime = googleOk
    ? googleOk.provider === "navitime"
    : leg.mode === mode && leg.polyline !== null && parseTrack(leg.polyline) !== null;

  return (
    <div className="screen">
      <header className="topbar glass">
        <Link to={back} className="icon-btn" aria-label="返回行程">
          <BackIcon />
        </Link>
        <div className="topbar-titles">
          <h1>交通方式</h1>
          <p>
            {from.name} → {to.name}
          </p>
        </div>
      </header>

      <main className="form">
        {departure !== null && (
          <p className={`${styles.when} card glass`}>
            {formatHhmm(departure)} 出發
            {shownMinutes !== null && Number.isFinite(shownMinutes) && ` → ${formatHhmm(departure + shownMinutes)} 抵達`}
          </p>
        )}

        <fieldset className="field">
          <legend>選擇方式{canLookup ? "（時間依出發時刻計算）" : ""}</legend>
          <div className={styles.modes}>
            {LEG_MODES.map((m) => {
              const r = lookup.state === "done" ? lookup.res.results[m] : undefined;
              return (
                <button
                  key={m}
                  type="button"
                  className={styles.mode}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                >
                  <span className={styles.modeName}>
                    <ModeIcon mode={m} size={18} />
                    {MODE_LABEL[m]}
                  </span>
                  <span className={styles.modeTime}>
                    {lookup.state === "loading" ? (
                      <span className={styles.searching}>
                        <span className="spinner" aria-hidden="true" />
                        查詢中…
                      </span>
                    ) : lookup.state === "done" ? (
                      resultLabel(r, m)
                    ) : (
                      ""
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {lookup.state === "unavailable" && <p className="hint">{lookup.reason}</p>}

        {steps.length > 0 && (
          <section className={`${styles.route} card glass`} aria-label="路線步驟">
            <div className={styles.routeHead}>
              <h2>
                {departure !== null ? `${formatHhmm(departure)} 出發` : "路線"}
                {googleOk && departure !== null && ` → ${formatHhmm(departure + googleOk.minutes)} 抵達`}
              </h2>
              <span className="hint">{fromNavitime ? "路線資料：NAVITIME" : "Google 路線"}</span>
            </div>
            {mode === "transit" && isWalkOnly(steps) && <p className="hint">這段距離沒有適合的大眾運輸，查到的路線是全程步行。</p>}
            <StepList steps={steps} departure={departure} />
            {mode === "transit" && canLookup && !isManual && (
              <button type="button" className={styles.refresh} disabled={refreshing || lookup.state === "loading"} aria-busy={refreshing} onClick={() => void refreshTransit()}>
                {refreshing && <span className="spinner" aria-hidden="true" />}
                {refreshing ? "查詢中…" : "重新查詢"}
              </button>
            )}
          </section>
        )}

        <div className={`${styles.manual} card glass`}>
          <label htmlFor="leg-manual" className={styles.manualLabel}>
            <span>手動輸入交通時間</span>
            <span className="hint">查不到路線或想自己估時使用；手動的時間不會被自動重查覆蓋</span>
          </label>
          <input
            id="leg-manual"
            type="checkbox"
            checked={isManual}
            disabled={lookup.state === "unavailable"}
            onChange={(e) => {
              setManual(e.target.checked);
              setError(null);
            }}
          />
        </div>

        {isManual && (
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
          </div>
        )}

        <div>
          <p className="group-caption">
            <label htmlFor="leg-note">備註</label>
          </p>
          <div className="group glass">
            <textarea
              id="leg-note"
              className="textarea"
              rows={3}
              maxLength={2000}
              placeholder="搭乘路線、轉乘站、月台、票價…"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </div>
        </div>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </main>

      <div className={`${styles.actions} glass`}>
        <a
          href={directionsUrl(
            { name: from.name, placeId: from.place_id, lat: from.lat, lng: from.lng },
            { name: to.name, placeId: to.place_id, lat: to.lat, lng: to.lng },
            mode,
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline"
        >
          在 Google Maps 開啟
        </a>
        <button type="button" className="btn btn-primary" onClick={() => void apply()}>
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
  const from = bundle?.stops.find((s) => s.id === leg?.from_stop_id);
  const to = bundle?.stops.find((s) => s.id === leg?.to_stop_id);
  if (!bundle || !leg || !from || !to) return <p className="empty">找不到這段交通，可能已被刪除。</p>;
  return <Editor key={leg.id} bundle={bundle} leg={leg} from={from} to={to} />;
}
