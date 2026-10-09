import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";

type Common = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Visible label. When there is none, `ariaLabel` names the control. */
  label?: ReactNode;
  ariaLabel?: string;
  /** Second line under the label. */
  description?: ReactNode;
  className?: string;
};

/**
 * Themed checkbox. A real `<input type="checkbox">` (keyboard, forms, screen readers) visually replaced by
 * `.mochi-check-box`, so every theme restyles it through tokens. Styles: `styles/features/form-controls.css`.
 */
export function Checkbox({ checked, onChange, disabled, label, ariaLabel, description, className = "", indeterminate }: Common & { indeterminate?: boolean }) {
  return <label className={`mochi-check ${disabled ? "is-disabled" : ""} ${className}`.trim()}>
    <input type="checkbox" className="mochi-check-input" checked={checked} disabled={disabled} aria-label={ariaLabel}
      aria-checked={indeterminate ? "mixed" : undefined} onChange={(event) => onChange(event.target.checked)} />
    <span className="mochi-check-box" aria-hidden="true">{indeterminate ? <Minus size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}</span>
    {(label || description) && <span className="mochi-check-text">{label && <span className="mochi-check-label">{label}</span>}{description && <small className="mochi-check-description">{description}</small>}</span>}
  </label>;
}

/** Themed on/off switch (`role="switch"`), for settings that take effect at once. */
export function Switch({ checked, onChange, disabled, label, ariaLabel, description, className = "" }: Common) {
  return <label className={`mochi-switch ${disabled ? "is-disabled" : ""} ${className}`.trim()}>
    {(label || description) && <span className="mochi-check-text">{label && <span className="mochi-check-label">{label}</span>}{description && <small className="mochi-check-description">{description}</small>}</span>}
    <input type="checkbox" role="switch" className="mochi-switch-input" checked={checked} disabled={disabled} aria-label={ariaLabel} aria-checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span className="mochi-switch-track" aria-hidden="true"><span className="mochi-switch-thumb" /></span>
  </label>;
}

/** A labelled form field: label text, the control, and an optional hint, laid out the same everywhere. */
export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={`mochi-field ${className}`.trim()}>
    <span className="mochi-field-label">{label}</span>
    {children}
    {hint && <small className="mochi-field-hint">{hint}</small>}
  </label>;
}
