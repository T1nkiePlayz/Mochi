import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { backlogStatuses, type BacklogStatus } from "../../lib/backlog";
import { ruleIsEmpty, ruleUsesHours, sanitizeRule, type SavedFilter, type SavedRule } from "../../lib/savedFilters";

type Props = {
  /** Rule to start from (the current view, or the filter being edited). */
  initial: SavedRule;
  existing?: SavedFilter;
  hoursAvailable: boolean;
  onSave: (name: string, rule: SavedRule) => void;
  onDelete?: () => void;
  onClose: () => void;
};

const split = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean);
const num = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Number(text));

/** Build or edit a saved smart filter: every field that is set must match. */
export function SavedFilterDialog({ initial, existing, hoursAvailable, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(existing?.name ?? "");
  const [status, setStatus] = useState<BacklogStatus[]>(initial.status ?? []);
  const [nextUp, setNextUp] = useState(Boolean(initial.nextUp));
  const [played, setPlayed] = useState<"" | "played" | "unplayed">(initial.played ?? "");
  const [favorite, setFavorite] = useState(Boolean(initial.favorite));
  const [installed, setInstalled] = useState(Boolean(initial.installed));
  const [tags, setTags] = useState((initial.tags ?? []).join(", "));
  const [categories, setCategories] = useState((initial.categories ?? []).join(", "));
  const [minHours, setMinHours] = useState(initial.minHours?.toString() ?? "");
  const [maxHours, setMaxHours] = useState(initial.maxHours?.toString() ?? "");

  const rule = sanitizeRule({ status, nextUp, played: played || undefined, favorite, installed, tags: split(tags), categories: split(categories), minHours: num(minHours), maxHours: num(maxHours) });
  const valid = name.trim() !== "" && !ruleIsEmpty(rule);
  const submit = (event: FormEvent) => { event.preventDefault(); if (valid) onSave(name, rule); };
  const toggleStatus = (id: BacklogStatus) => setStatus((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  return <div className="modal-backdrop" onClick={onClose}>
    <form className="modal saved-filter-dialog" role="dialog" aria-modal="true" aria-label={existing ? "Edit saved filter" : "Save filter"} onClick={(event) => event.stopPropagation()} onSubmit={submit}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div className="modal-header"><div><p className="eyebrow">Library</p><h2>{existing ? "Edit saved filter" : "Save filter"}</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
      <label className="field">Name<input value={name} maxLength={40} placeholder="e.g. Short and unplayed" autoFocus onChange={(event) => setName(event.target.value)} /></label>
      <fieldset className="field"><legend>Backlog status (any of)</legend>
        <div className="filter-row">{backlogStatuses.map(({ id, label }) => <button type="button" key={id} className={`filter-chip ${status.includes(id) ? "active" : ""}`} aria-pressed={status.includes(id)} onClick={() => toggleStatus(id)}>{label}</button>)}</div>
      </fieldset>
      <div className="filter-row">
        <label><input type="checkbox" checked={nextUp} onChange={(event) => setNextUp(event.target.checked)} /> Next up</label>
        <label><input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} /> Favourite</label>
        <label><input type="checkbox" checked={installed} onChange={(event) => setInstalled(event.target.checked)} /> Installed</label>
        <label>Played <select value={played} onChange={(event) => setPlayed(event.target.value as typeof played)}><option value="">Any</option><option value="unplayed">Never</option><option value="played">Already</option></select></label>
      </div>
      <label className="field">Tags (all of, comma separated)<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="co-op, couch" /></label>
      <label className="field">Genres (any of, comma separated)<input value={categories} onChange={(event) => setCategories(event.target.value)} placeholder="Adventure, Puzzle" /></label>
      <div className="filter-row">
        <label>Hours to beat, from <input type="number" min={0} max={2000} value={minHours} onChange={(event) => setMinHours(event.target.value)} style={{ width: "5em" }} /></label>
        <label>to <input type="number" min={0} max={2000} value={maxHours} onChange={(event) => setMaxHours(event.target.value)} style={{ width: "5em" }} /></label>
      </div>
      {ruleUsesHours(rule) && <p className="metadata-note">{hoursAvailable ? "Only games with IGDB time-to-beat data can match an hours range." : "Hours come from IGDB: connect it under Settings > Mod & metadata providers, and open What should I play? once to fetch them."}</p>}
      <div className="modal-actions">
        {existing && onDelete && <button type="button" className="secondary-button danger-outline" onClick={onDelete}>Delete</button>}
        <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
        <button type="submit" className="play-button" disabled={!valid}>{existing ? "Save" : "Save filter"}</button>
      </div>
    </form>
  </div>;
}
