import type { RefCallback } from "react";

/** Pixels the mouse must travel before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD = 5;

/**
 * Ref callback that lets a mouse scroll a horizontal strip: press and drag
 * sideways, or turn the wheel. Touch and pen keep the browser's native swipe.
 * A drag swallows the click it ends with, so it never selects the item under it.
 */
export const dragScroll: RefCallback<HTMLElement> = (el) => {
  if (!el) return;

  let pointerId: number | null = null;
  let startX = 0;
  let startLeft = 0;
  let dragged = false;

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startLeft = el.scrollLeft;
    dragged = false;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!dragged) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      dragged = true;
      el.setPointerCapture(e.pointerId);
      el.dataset.dragging = "true";
    }
    el.scrollLeft = startLeft - dx;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    delete el.dataset.dragging;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  const onClick = (e: MouseEvent) => {
    if (!dragged) return;
    dragged = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    // At either end, let the wheel scroll the page as usual.
    if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("click", onClick, true);
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    el.removeEventListener("click", onClick, true);
    el.removeEventListener("wheel", onWheel);
  };
};
