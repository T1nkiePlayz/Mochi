import { useRef, useState, type FormEvent } from "react";
import { FolderPlus, Heart, Tag, Trash2, X } from "lucide-react";
import type { Collection, Piko } from "../../models";
import { CollectionPicker } from "./CollectionPicker";
import { useDismiss } from "./useDismiss";

type Props = {
  games: Piko[];
  collections: Collection[];
  onToggleCollection: (collectionId: string, on: boolean) => void;
  onCreateCollection: (name: string) => Collection | null;
  onAddTag: (tag: string) => void;
  onFavorite: (on: boolean) => void;
  onRemove: () => void;
  onSelectAll: () => void;
  onDone: () => void;
};

/** Actions for the games ticked in multi-select mode. */
export function BulkActionBar({ games, collections, onToggleCollection, onCreateCollection, onAddTag, onFavorite, onRemove, onSelectAll, onDone }: Props) {
  const [panel, setPanel] = useState<"" | "collection" | "tag">("");
  const [tag, setTag] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, Boolean(panel), () => setPanel(""));
  const empty = games.length === 0;
  const submitTag = (event: FormEvent) => { event.preventDefault(); if (tag.trim()) { onAddTag(tag); setTag(""); setPanel(""); } };

  return <div className="bulk-bar" ref={ref} role="toolbar" aria-label="Actions for selected games">
    <strong aria-live="polite">{games.length} selected</strong>
    <button type="button" className="text-button" onClick={onSelectAll}>Select all</button>
    <div className="bulk-actions">
      <div className="bulk-popover-anchor">
        <button type="button" className="secondary-button" disabled={empty} aria-expanded={panel === "collection"} onClick={() => setPanel(panel === "collection" ? "" : "collection")}><FolderPlus size={14} /> Collection</button>
        {panel === "collection" && <div className="library-popover"><CollectionPicker collections={collections} games={games} onToggle={onToggleCollection} onCreate={onCreateCollection} /></div>}
      </div>
      <div className="bulk-popover-anchor">
        <button type="button" className="secondary-button" disabled={empty} aria-expanded={panel === "tag"} onClick={() => setPanel(panel === "tag" ? "" : "tag")}><Tag size={14} /> Tag</button>
        {panel === "tag" && <form className="library-popover collection-picker-new" onSubmit={submitTag}><input autoFocus value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Tag name" aria-label="Tag to add" maxLength={32} /><button type="submit" className="secondary-button" disabled={!tag.trim()}>Add</button></form>}
      </div>
      <button type="button" className="secondary-button" disabled={empty} onClick={() => onFavorite(!games.every((game) => game.favorite))}><Heart size={14} /> {games.length && games.every((game) => game.favorite) ? "Unfavourite" : "Favourite"}</button>
      <button type="button" className="secondary-button danger-outline" disabled={empty} onClick={onRemove}><Trash2 size={14} /> Remove</button>
    </div>
    <button type="button" className="icon-button" aria-label="Exit selection mode" onClick={onDone}><X size={16} /></button>
  </div>;
}
