import { useEffect, useRef, type ReactNode } from "react";

const focusable = "a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

/**
 * Backdrop + dialog frame for the mod pickers and detail pages: Escape and outside click close it,
 * focus moves in, stays inside while Tab is pressed, and returns to the opener afterwards.
 */
export function ModalShell({ label, className, onClose, children }: { label: string; className: string; onClose: () => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = root.current?.querySelector<HTMLElement>("[data-autofocus]") ?? root.current?.querySelector<HTMLElement>(focusable);
    (first ?? root.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab" || !root.current) return;
      const items = [...root.current.querySelectorAll<HTMLElement>(focusable)].filter((item) => item.offsetParent !== null);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); opener?.focus?.(); };
  }, []);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}>
    <div ref={root} className={className} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>{children}</div>
  </div>;
}
