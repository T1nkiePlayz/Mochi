import { useEffect, type RefObject } from "react";

/** Closes a popover/menu on outside pointer press or Escape. */
export function useDismiss(ref: RefObject<HTMLElement>, active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [active, close, ref]);
}
