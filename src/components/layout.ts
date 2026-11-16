import { useSyncExternalStore } from "react";

export type Layout = "phone" | "tablet" | "desktop";

/** Keep in sync with the `@media (min-width: …)` breakpoints in the CSS. */
export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1024;

const tabletQuery = `(min-width: ${String(TABLET_MIN)}px)`;
const desktopQuery = `(min-width: ${String(DESKTOP_MIN)}px)`;

function subscribe(onChange: () => void): () => void {
  const lists = [window.matchMedia(tabletQuery), window.matchMedia(desktopQuery)];
  for (const l of lists) l.addEventListener("change", onChange);
  return () => {
    for (const l of lists) l.removeEventListener("change", onChange);
  };
}

function current(): Layout {
  if (window.matchMedia(desktopQuery).matches) return "desktop";
  if (window.matchMedia(tabletQuery).matches) return "tablet";
  return "phone";
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, current, () => "phone");
}
