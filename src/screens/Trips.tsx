import { useRef, useState } from "react";
import { Link } from "react-router";
import type { MeResponse } from "../../shared/api";
import { NetworkError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { PlusIcon, SettingsIcon, WarningIcon } from "../components/icons";
import { SyncStatus, usePendingCount } from "../components/SyncStatus";
import { useAllTripBundles } from "../data/queries";
import { localToday, summarizeTrip, type TripGroup, type TripSummary } from "../data/summary";
import type { TripBundle } from "../data/queries";
import styles from "./Trips.module.css";

const GROUP_TITLE: Record<TripGroup, string> = { upcoming: "即將出發", draft: "規劃中", past: "已結束" };
const GROUP_ORDER: TripGroup[] = ["upcoming", "draft", "past"];

function TripCard({ bundle, summary }: { bundle: TripBundle; summary: TripSummary }) {
  const { trip } = bundle;
  return (
    <Link to={`/trips/${trip.id}`} className={`${styles.trip} card card-link glass`}>
      <div className={styles.tripHead}>
        <div className={styles.tripTitles}>
          <h3>{trip.name}</h3>
          <p>{summary.dateText}</p>
        </div>
        {summary.group === "draft" && <span className="badge badge-muted">草稿</span>}
      </div>
      {summary.group !== "past" && (
        <div className={styles.stats}>
          <div>
            <strong>{summary.dayCount}</strong>
            <span>天</span>
          </div>
          <div>
            <strong>{summary.stopCount}</strong>
            <span>個地點</span>
          </div>
          <div>
            <strong>{summary.reservationCount}</strong>
            <span>筆訂位</span>
          </div>
        </div>
      )}
      {summary.conflicts.map((c) => (
        <p key={c.dayNumber} className={styles.conflict}>
          <WarningIcon size={16} />
          Day {c.dayNumber} 有 {c.count} 則時間衝突
        </p>
      ))}
    </Link>
  );
}

function SettingsSheet({ user, dialogRef }: { user: MeResponse; dialogRef: React.RefObject<HTMLDialogElement | null> }) {
  const { logout } = useAuth();
  const pending = usePendingCount();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function doLogout() {
    logout().catch((err: unknown) => {
      setError(err instanceof NetworkError ? "需要連線才能登出。" : "登出失敗，請稍後再試。");
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby="settings-title"
      onClose={() => {
        setConfirming(false);
        setError(null);
      }}
    >
      <div className={styles.sheet}>
        <h2 id="settings-title">設定</h2>
        <p className="hint">已登入：{user.username}</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {confirming ? (
          <>
            <p className="error-text" role="alert">
              有 {pending} 筆變更尚未上傳，登出會遺失這些變更。
            </p>
            <button type="button" className="btn btn-danger btn-block" onClick={doLogout}>
              仍要登出
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={() => {
              if ((pending ?? 0) > 0) setConfirming(true);
              else doLogout();
            }}
          >
            登出並清除這台裝置的資料
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-block" onClick={() => dialogRef.current?.close()}>
          關閉
        </button>
      </div>
    </dialog>
  );
}

export function Trips({ user }: { user: MeResponse }) {
  const bundles = useAllTripBundles();
  const settingsRef = useRef<HTMLDialogElement>(null);
  const today = localToday();

  const grouped = new Map<TripGroup, { bundle: TripBundle; summary: TripSummary }[]>();
  for (const bundle of bundles ?? []) {
    const summary = summarizeTrip(bundle, today);
    grouped.set(summary.group, [...(grouped.get(summary.group) ?? []), { bundle, summary }]);
  }
  for (const [group, list] of grouped) {
    list.sort((a, b) => {
      const da = a.bundle.trip.start_date ?? "";
      const db = b.bundle.trip.start_date ?? "";
      return group === "past" ? db.localeCompare(da) : da.localeCompare(db);
    });
  }

  return (
    <div className="screen">
      <header className={styles.header}>
        <h1>我的旅程</h1>
        <div className={styles.headerActions}>
          <button type="button" className="icon-btn" aria-label="設定" onClick={() => settingsRef.current?.showModal()}>
            <SettingsIcon />
          </button>
          <Link to="/trips/new" className="btn btn-primary btn-pill">
            <PlusIcon size={16} />
            建立旅程
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        {bundles && bundles.length === 0 && <p className="empty">還沒有旅程。按「建立旅程」開始規劃。</p>}
        {GROUP_ORDER.map((group) => {
          const list = grouped.get(group);
          if (!list?.length) return null;
          return (
            <section key={group} className={styles.group} aria-labelledby={`group-${group}`}>
              <h2 id={`group-${group}`} className="section-title">
                {GROUP_TITLE[group]}
              </h2>
              {list.map(({ bundle, summary }) => (
                <TripCard key={bundle.trip.id} bundle={bundle} summary={summary} />
              ))}
            </section>
          );
        })}
      </main>

      <SyncStatus />
      <SettingsSheet user={user} dialogRef={settingsRef} />
    </div>
  );
}
