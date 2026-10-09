import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, X } from "lucide-react";
import { openExternalUrl } from "../../lib/platform";
import { type DependencyEntry } from "../../lib/mods/dependencies";
import { Checkbox } from "../ui/Checkbox";
import { ModalShell } from "./ModalShell";
import type { DependencyPrompt } from "./useModInstall";

const statusText = { install: "Will install", "already-installed": "Already installed", unavailable: "Unavailable", external: "Get it yourself" } as const;
const open = (url: string) => void openExternalUrl(url).catch(() => undefined);

function PageLink({ url, label }: { url: string; label: string }) {
  return <button type="button" className="secondary-button dep-link" onClick={() => open(url)}><ExternalLink size={13} /> {label}</button>;
}

function Row({ entry, checked, onChange }: { entry: DependencyEntry; checked: boolean; onChange: (checked: boolean) => void }) {
  const description = [entry.version, entry.status === "install" ? `needed by ${entry.requiredBy}` : entry.reason].filter(Boolean).join(" · ");
  const Icon = entry.status === "install" ? CheckCircle2 : entry.status === "already-installed" ? CheckCircle2 : entry.status === "unavailable" ? AlertTriangle : HelpCircle;
  return <li className="dep-row" data-status={entry.status}>
    {entry.status === "install"
      ? <Checkbox checked={checked} onChange={onChange} label={entry.name} description={description} />
      : <div className="dep-row-text"><strong>{entry.name}</strong><small>{description}</small></div>}
    <span className={`compat-badge dep-badge dep-${entry.status}`}><Icon size={12} aria-hidden="true" />{statusText[entry.status]}</span>
    {(entry.status === "unavailable" || entry.status === "external") && entry.pageUrl && <PageLink url={entry.pageUrl} label="Open page" />}
  </li>;
}

/** "This mod needs these": the mod, its required dependencies with checkboxes, anything to do by hand, and conflict warnings. */
export function DependencySheet({ prompt }: { prompt: DependencyPrompt }) {
  const { item, plan, answer } = prompt;
  const installable = useMemo(() => plan.entries.filter((entry) => entry.status === "install"), [plan]);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const chosen = installable.filter((entry) => !skipped.has(entry.key));
  const toggle = (key: string, on: boolean) => setSkipped((previous) => { const next = new Set(previous); if (on) next.delete(key); else next.add(key); return next; });
  const manual = plan.entries.filter((entry) => entry.status === "unavailable" || entry.status === "external");
  const done = plan.entries.filter((entry) => entry.status === "already-installed");
  const total = chosen.length + 1;
  return <ModalShell label={`Dependencies of ${item.name}`} className="tofu-picker-window dependency-sheet" onClose={() => answer(null)}>
    <div className="modal-header"><div><p className="eyebrow">Install {item.name}</p><h2>Dependencies</h2></div><button type="button" className="icon-button" aria-label="Cancel" onClick={() => answer(null)}><X size={17} /></button></div>
    <div className="dep-body">
    <p className="modal-description">{item.name} needs {plan.entries.length === 1 ? "another mod" : `${plan.entries.length || "no other"} mods`} to work. Checked ones are downloaded first, with the same checks as any download.</p>
    {plan.warnings.map((warning) => <p key={`${warning.declaredBy}>${warning.name}`} className="metadata-note dep-warning" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {warning.declaredBy} is marked incompatible with {warning.installedTitle}, which is installed. <button type="button" className="secondary-button dep-link" onClick={() => open(warning.pageUrl)}>View</button></p>)}
    <ul className="dep-list" aria-label="Mod and dependencies">
      <li className="dep-row"><Checkbox checked disabled onChange={() => undefined} label={item.name} description="The mod you chose" /><span className="compat-badge dep-badge dep-install"><CheckCircle2 size={12} aria-hidden="true" />Will install</span></li>
      {installable.map((entry) => <Row key={entry.key} entry={entry} checked={!skipped.has(entry.key)} onChange={(on) => toggle(entry.key, on)} />)}
      {done.map((entry) => <Row key={entry.key} entry={entry} checked={false} onChange={() => undefined} />)}
    </ul>
    {manual.length > 0 && <>
      <h3 className="tofu-picker-heading dep-heading">Needs you</h3>
      <ul className="dep-list" aria-label="Requirements Mochi cannot install">{manual.map((entry) => <Row key={entry.key} entry={entry} checked={false} onChange={() => undefined} />)}</ul>
    </>}
    {plan.truncated && <p className="metadata-note" role="note">The dependency chain is very long, so Mochi stopped looking. Check the mod's page for the rest.</p>}
    {plan.notes.map((note) => <p key={note} className="metadata-note" role="note">{note}</p>)}
    </div>
    <div className="mod-download-actions dep-actions">
      <button type="button" className="play-button" onClick={() => answer(chosen)} data-autofocus>Install {total}</button>
      <button type="button" className="secondary-button" onClick={() => answer([])}>Install without dependencies</button>
      <button type="button" className="secondary-button" onClick={() => answer(null)}>Cancel</button>
    </div>
  </ModalShell>;
}
