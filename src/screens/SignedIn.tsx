import { useState } from "react";
import type { MeResponse } from "../../shared/api";
import { NetworkError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { SyncStatus, usePendingCount } from "../components/SyncStatus";

/** Temporary landing page until the trip list arrives in phase 4. */
export function SignedIn({ user }: { user: MeResponse }) {
  const { logout } = useAuth();
  const pending = usePendingCount();
  const [error, setError] = useState<string | null>(null);

  function onLogout() {
    if (pending > 0 && !window.confirm(`有 ${pending} 筆變更尚未上傳，登出會遺失。仍要登出？`)) return;
    logout().catch((err: unknown) => {
      setError(err instanceof NetworkError ? "需要連線才能登出。" : "登出失敗，請稍後再試。");
    });
  }

  return (
    <>
      <main className="app-shell">
        <h1>我的旅程</h1>
        <p>已登入：{user.username}</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={onLogout}>
          登出
        </button>
      </main>
      <SyncStatus />
    </>
  );
}
