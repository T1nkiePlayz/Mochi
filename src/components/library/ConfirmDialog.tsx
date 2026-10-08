import { useEffect, useRef } from "react";

type Props = { title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void };

/** In-app replacement for window.confirm. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onCancel }: Props) {
  const cancel = useRef<HTMLButtonElement>(null);
  // Parents pass inline callbacks; keep the latest one without re-running the effects (which would steal focus back to Cancel).
  const latest = useRef(onCancel);
  latest.current = onCancel;
  useEffect(() => { cancel.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") latest.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return <div className="modal-backdrop confirm-backdrop" onClick={onCancel}>
    <div className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
      <h2>{title}</h2>
      <p className="modal-description">{message}</p>
      <div className="confirm-actions">
        <button type="button" ref={cancel} className="secondary-button" onClick={onCancel}>Cancel</button>
        <button type="button" className={danger ? "secondary-button danger-outline" : "play-button"} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}
