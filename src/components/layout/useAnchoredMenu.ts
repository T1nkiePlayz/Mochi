import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const MARGIN = 8;

/** Fixed-position style for a popover anchored to `trigger`, placed by shell and clamped to the viewport. Recomputed on resize/scroll while open. */
export function useAnchoredMenu(trigger: RefObject<HTMLElement>, open: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const el = trigger.current;
    if (!open || !el) { setStyle(undefined); return; }
    let frame = 0;
    const place = () => {
      frame = 0;
      const r = el.getBoundingClientRect(), root = document.documentElement;
      const shell = root.dataset.mochiShell ?? "left", drawer = root.dataset.navMode === "drawer";
      const vw = window.innerWidth, vh = window.innerHeight, maxW = vw - MARGIN * 2;
      const rail = shell === "rail" && !drawer, bar = (shell === "top" || shell === "bottom") && !drawer;
      const width = Math.min(rail ? 240 : bar ? 280 : Math.max(r.width, 220), maxW);
      // Bars open under (or over) the trigger, right-aligned to it; side shells open beside it (rail) or under it.
      let left = rail ? r.right + 10 : bar ? r.right - width : r.left;
      left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
      const next: CSSProperties = { position: "fixed", left, width };
      if (shell === "bottom" && !drawer) { next.bottom = vh - r.top + MARGIN; next.maxHeight = Math.max(120, r.top - MARGIN * 2); }
      else { const top = rail ? Math.max(MARGIN, r.top) : r.bottom + 6; next.top = top; next.maxHeight = Math.max(120, vh - top - MARGIN); }
      setStyle(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => { window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true); if (frame) cancelAnimationFrame(frame); };
  }, [trigger, open]);
  return style;
}
