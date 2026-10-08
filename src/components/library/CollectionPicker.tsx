import { useState, type FormEvent } from "react";
import { Check, Minus, Plus } from "lucide-react";
import type { Collection, Piko } from "../../models";

type Props = {
  collections: Collection[];
  games: Piko[];
  onToggle: (collectionId: string, on: boolean) => void;
  onCreate: (name: string) => Collection | null;
};

/** Toggle list used by the "Add to collection…" popover, the context menu and bulk actions. */
export function CollectionPicker({ collections, games, onToggle, onCreate }: Props) {
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const created = onCreate(name);
    if (created) { onToggle(created.id, true); setName(""); }
  };
  return <div className="collection-picker">
    {collections.length ? <ul role="group" aria-label="Collections">{collections.map((collection) => {
      const count = games.filter((game) => game.collectionIds?.includes(collection.id)).length;
      const all = games.length > 0 && count === games.length;
      return <li key={collection.id}><button type="button" role="menuitemcheckbox" aria-checked={all ? true : count ? "mixed" : false} className={all ? "on" : ""} onClick={() => onToggle(collection.id, !all)}>
        <span className="collection-check" aria-hidden="true">{all ? <Check size={12} /> : count ? <Minus size={12} /> : null}</span>
        <span>{collection.icon ? `${collection.icon} ` : ""}{collection.name}</span>
      </button></li>;
    })}</ul> : <p className="metadata-note">No collections yet. Create one below.</p>}
    <form className="collection-picker-new" onSubmit={submit}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New collection" aria-label="New collection name" maxLength={40} />
      <button type="submit" className="icon-button" aria-label="Create collection" disabled={!name.trim()}><Plus size={14} /></button>
    </form>
  </div>;
}
