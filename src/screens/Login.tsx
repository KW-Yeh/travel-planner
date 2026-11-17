import { useEffect, useState, type SubmitEvent } from "react";
import { useAuth } from "../auth/AuthProvider";
import { MapIcon } from "../components/icons";
import { describeLoginError, formatWait } from "./login-messages";
import styles from "./Login.module.css";

export function Login({ offline = false }: { offline?: boolean }) {
  const { login, retry } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [lockedUntil]);

  const lockRemainingSec = lockedUntil === null ? 0 : (lockedUntil - now) / 1000;
  const locked = lockRemainingSec > 0;

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || locked) return;
    if (!username.trim() || !password) {
      setError("請輸入帳號和密碼。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await login({ username: username.trim(), password });
    } catch (err) {
      const failure = describeLoginError(err);
      setError(failure.message);
      if (failure.lockedForSec !== undefined) {
        const t = Date.now();
        setNow(t);
        setLockedUntil(t + failure.lockedForSec * 1000);
      }
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.center}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <MapIcon size={30} />
          </span>
          <div className={styles.titles}>
            <h1 className={styles.title}>旅程規劃</h1>
            <p className={styles.subtitle}>登入後，行程會在你的所有裝置之間同步。</p>
          </div>
        </div>

        {offline ? (
          <div className={styles.form}>
            <p className={styles.alert} role="alert">
              目前沒有網路連線。第一次登入需要連線。
            </p>
            <button type="button" className={styles.primary} onClick={retry}>
              重試
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
            <div className={styles.field}>
              <label htmlFor="account" className={styles.label}>
                帳號
              </label>
              <input
                id="account"
                className={styles.input}
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                }}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>
                密碼
              </label>
              <input
                id="password"
                className={styles.input}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
              />
            </div>
            {error && (
              <p className={styles.alert} role="alert">
                {error}
                {locked && `請在 ${formatWait(lockRemainingSec)} 後再試。`}
              </p>
            )}
            <button
              type="submit"
              className={styles.primary}
              disabled={submitting || locked}
              aria-busy={submitting}
            >
              {submitting && !locked && <span className="spinner" aria-hidden="true" />}
              {locked ? "暫時鎖定中" : submitting ? "登入中…" : "登入"}
            </button>
            <p className={styles.note}>這台裝置會保持登入 30 天。</p>
          </form>
        )}
      </div>

      <p className={styles.note}>此服務不開放註冊，帳號由管理者設定。</p>
    </div>
  );
}
