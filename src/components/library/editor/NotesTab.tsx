import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cleanLink, LINKS_MAX, NOTES_MAX } from "../../../lib/gameNotes";
import type { EditorContext } from "./types";
import { useTranslation } from "../../../lib/useTranslation";

export function NotesTab({ ctx }: { ctx: EditorContext }) {
  const t = useTranslation();
  const { draft, patch } = ctx;
  const links = draft.links ?? [];
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const link = cleanLink({ label, url });
    if (!link) { setError(t("Enter a web address starting with http:// or https://.")); return; }
    patch({ links: [...links, link] });
    setLabel(""); setUrl(""); setError("");
  };
  return <div className="form-fields editor-fields">
    <label>Notes
      <textarea rows={8} maxLength={NOTES_MAX} value={draft.notes ?? ""} placeholder="Build notes, mod load order, where you left off…" onChange={(event) => patch({ notes: event.target.value })} />
      <small>{(draft.notes ?? "").length.toLocaleString()} / {NOTES_MAX.toLocaleString()}. Plain text. Included in library backups.</small>
    </label>
    <fieldset className="editor-links">
      <legend>Links</legend>
      {links.map((link, index) => <div className="editor-link-row" key={`${link.url}-${index}`}>
        <span title={link.url}><strong>{link.label}</strong><small>{link.url}</small></span>
        <button type="button" className="icon-button" aria-label={t("Remove link {label}").replace("{label}", link.label)} onClick={() => patch({ links: links.filter((_item, at) => at !== index) })}><Trash2 size={15} /></button>
      </div>)}
      {links.length < LINKS_MAX && <div className="editor-link-add">
        <input value={label} placeholder={t("Label (optional)")} aria-label={t("Link label")} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
        <input value={url} placeholder={t("https://…")} aria-label={t("Link address")} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
        <button type="button" className="secondary-button" onClick={add}><Plus size={14} /> Add</button>
      </div>}
      {error && <small role="alert">{error}</small>}
    </fieldset>
  </div>;
}
