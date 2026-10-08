import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Decides whether a popover opens below or above its trigger so it never runs off the
 * bottom of the window, and how tall its list may be. Measured when it opens.
 */
export function usePopoverPlacement(open: boolean, root: RefObject<HTMLElement>, wanted = 320): { placement: "bottom" | "top"; maxHeight: number } {
  const [state, setState] = useState<{ placement: "bottom" | "top"; maxHeight: number }>({ placement: "bottom", maxHeight: wanted });
  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const margin = 16;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const placement = below < Math.min(wanted, 220) && above > below ? "top" : "bottom";
    setState({ placement, maxHeight: Math.max(160, Math.min(wanted, placement === "top" ? above : below)) });
  }, [open, root, wanted]);
  return state;
}
