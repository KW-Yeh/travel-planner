import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { db } from "../db/db";
import type { SyncPhase } from "../sync/engine";
import { syncEngine } from "../sync/instance";
import styles from "./SyncStatus.module.css";

export function describeSync(phase: SyncPhase, pending: number): { text: string; tone: "ok" | "busy" | "warn" | "error" } {
  switch (phase) {
    case "syncing":
      return { text: "同步中…", tone: "busy" };
    case "offline":
      return { text: pending > 0 ? `離線（${pending} 筆待上傳）` : "離線，顯示本機資料", tone: "warn" };
    case "error":
      return { text: "同步失敗，稍後重試", tone: "error" };
    case "unauthorized":
      return { text: "登入已過期", tone: "error" };
    case "idle":
      return pending > 0 ? { text: `${pending} 筆待上傳`, tone: "busy" } : { text: "已同步到雲端", tone: "ok" };
  }
}

export function usePendingCount(): number {
  return useLiveQuery(() => db.outbox.count(), [], 0);
}

export function SyncStatus() {
  const { phase } = useSyncExternalStore(syncEngine.subscribe, syncEngine.getStatus);
  const pending = usePendingCount();
  const { text, tone } = describeSync(phase, pending);
  return (
    <footer className={styles.bar} role="status" aria-live="polite">
      <span className={`${styles.dot} ${styles[tone]}`} aria-hidden="true" />
      {text}
    </footer>
  );
}
