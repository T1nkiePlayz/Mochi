import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";

type Props = {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  /** Exactly what will be deleted, shown as a list. */
  items?: string[];
  onConfirm: () => void; onCancel: () => void;
};

const MAX_ITEMS = 8;

/** Themed "Are you sure?" dialog. Prefer `confirmAction()` from lib/confirm; render this directly only for local state flows. */
export function ConfirmDialog({ title, message, confirmLabel, danger, items, onConfirm, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId(), messageId = useId();
  // Parents pass inline callbacks; keep the latest one without re-running the effects (which would steal focus back to Cancel).
  const latest = useRef(onCancel);
  latest.current = onCancel;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    // Window capture runs before every document listener, so Escape closes only this dialog, never the modal or menu under it.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); latest.current(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const shown = items?.slice(0, MAX_ITEMS) ?? [];
  const more = (items?.length ?? 0) - shown.length;
  return <div className="modal-backdrop confirm-backdrop" onClick={onCancel}>
    <div className={`modal confirm-dialog${danger ? " is-danger" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} onClick={(event) => event.stopPropagation()}>
      <div className="confirm-heading">
        {danger && <span className="confirm-icon" aria-hidden="true"><AlertTriangle size={18} /></span>}
        <h2 id={titleId}>{title}</h2>
      </div>
      <p className="modal-description" id={messageId}>{message}</p>
      {shown.length > 0 && <ul className="confirm-items" aria-label="Will be deleted">
        {shown.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        {more > 0 && <li className="confirm-items-more">and {more} more</li>}
      </ul>}
      <div className="confirm-actions">
        <button type="button" ref={cancel} className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className={danger ? "secondary-button danger-outline danger-solid" : "play-button"} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}
