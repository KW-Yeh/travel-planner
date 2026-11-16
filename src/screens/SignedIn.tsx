import { useState } from "react";
import type { MeResponse } from "../../shared/api";
import { useAuth } from "../auth/AuthProvider";

/** Temporary landing page until the trip list arrives in phase 4. */
export function SignedIn({ user }: { user: MeResponse }) {
  const { logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="app-shell">
      <h1>我的旅程</h1>
      <p>已登入：{user.username}</p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        onClick={() => {
          logout().catch(() => {
            setError("登出失敗，請確認網路後再試。");
          });
        }}
      >
        登出
      </button>
    </main>
  );
}
