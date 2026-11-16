import { useEffect, useState } from "react";
import styles from "./InstallPrompt.module.css";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISS_KEY = "installPromptDismissedAt";
const SNOOZE_MS = 7 * 86_400_000;

// The event can fire before React mounts, so it is captured at module load.
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    for (const l of listeners) l();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    for (const l of listeners) l();
  });
}

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function standalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function iosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(deferred);
  const [hidden, setHidden] = useState(() => standalone() || snoozed());
  const ios = !event && iosSafari();

  useEffect(() => {
    const update = () => {
      setEvent(deferred);
    };
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (hidden || (!event && !ios)) return null;

  function later() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private mode: the card just comes back next visit.
    }
    setHidden(true);
  }

  async function install() {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    deferred = null;
    setEvent(null);
    if (outcome === "dismissed") later();
  }

  return (
    <aside className={styles.card} aria-labelledby="install-title">
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className={styles.icon} />
      <div className={styles.text}>
        <h2 id="install-title">加到主畫面</h2>
        {ios ? (
          <p>
            在 Safari 點下方的「分享」<span aria-hidden>（方框加向上箭頭）</span>，再選「加入主畫面」。離線時也能打開行程。
          </p>
        ) : (
          <p>像 App 一樣從主畫面開啟，離線時也能看行程。</p>
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.later} onClick={later}>
          稍後再說
        </button>
        {!ios && (
          <button type="button" className={styles.install} onClick={() => void install()}>
            安裝
          </button>
        )}
      </div>
    </aside>
  );
}
