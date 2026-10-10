import { useEffect, useState } from "react";
import { backlogStatuses, NOTE_MAX, withBacklogNote, withBacklogStatus, withNextUp, type Backlog } from "../../lib/backlog";

type Props = {
  value?: Backlog;
  onChange: (next: Backlog | undefined) => void;
  /** Save the note on every keystroke (editor draft) or when the field loses focus (live library). */
  commit?: "change" | "blur";
};

/** Backlog status chips ("Want to play" ... "Dropped") plus a short note. Shared by the game page and the editor. */
export function BacklogControl({ value, onChange, commit = "blur" }: Props) {
  const [note, setNote] = useState(value?.note ?? "");
  useEffect(() => setNote(value?.note ?? ""), [value?.note]);
  const save = (text: string) => { if (text.trim() !== (value?.note ?? "")) onChange(withBacklogNote(value, text)); };
  return <div className="backlog-control">
    <div className="filter-row" role="group" aria-label="Backlog status">
      <button type="button" className={`filter-chip ${value ? "" : "active"}`} aria-pressed={!value} onClick={() => onChange(undefined)}>Not tracked</button>
      {backlogStatuses.map(({ id, label }) => <button type="button" key={id} className={`filter-chip ${value?.status === id ? "active" : ""}`} aria-pressed={value?.status === id} onClick={() => onChange(withBacklogStatus(value, id))}>{label}</button>)}
      {value && (value.status === "want" || value.status === "playing") && <button type="button" className={`filter-chip ${value.nextUp ? "active" : ""}`} aria-pressed={Boolean(value.nextUp)} title="Games marked Next up are picked first by What should I play?" onClick={() => onChange(withNextUp(value, !value.nextUp))}>Next up</button>}
    </div>
    {value && <input className="backlog-note" value={note} maxLength={NOTE_MAX} placeholder="Note, e.g. recommended by a friend" aria-label="Backlog note"
      onChange={(event) => { setNote(event.target.value); if (commit === "change") save(event.target.value); }}
      onBlur={() => save(note)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(note); } }} />}
  </div>;
}
