import type { ReactNode } from "react";

export function SettingsGroup({ title, subtitle, id, className = "", children }: { title: string; subtitle?: string; id?: string; className?: string; children: ReactNode }) {
  return <div className={`settings-group ${className}`.trim()} id={id}>
    <div className="settings-group-heading"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
    {children}
  </div>;
}

export function ToggleRow({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="setting-row"><span><strong>{title}</strong><small>{description}</small></span><input className="toggle" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" /></label>;
}
