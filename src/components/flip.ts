import { useLayoutEffect, useRef, type RefObject } from "react";

type Snapshot = { order: string; rects: Map<string, DOMRect> };

/**
 * FLIP for a keyed list whose order changes asynchronously (e.g. a Dexie write that a live query
 * picks up a render or two later). Call the returned function right before the change: it records
 * where every row is. When `order` next differs, each moved row is animated from its old spot.
 */
export function useFlip(rows: RefObject<Map<string, HTMLElement>>, order: string): () => void {
  const pending = useRef<Snapshot | null>(null);

  useLayoutEffect(() => {
    const snap = pending.current;
    if (!snap || snap.order === order) return;
    pending.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, el] of rows.current) {
      const before = snap.rects.get(id);
      if (!before) continue;
      const dy = before.top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      el.animate([{ translate: `0 ${String(dy)}px` }, { translate: "0 0" }], { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
  }, [rows, order]);

  return () => {
    const rects = new Map<string, DOMRect>();
    for (const [id, el] of rows.current) rects.set(id, el.getBoundingClientRect());
    pending.current = { order, rects };
  };
}
