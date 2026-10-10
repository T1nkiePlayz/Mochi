import { useRef, useState, type FormEvent } from "react";
import { useDismiss } from "../ui/useDismiss";
import { ArrowDown, ArrowUp, Trash2, X } from "lucide-react";
import type { Collection } from "../../models";
import type { CollectionsState } from "../../state/useCollections";
import { ConfirmDialog } from "./ConfirmDialog";
import { useTranslation } from "../../lib/useTranslation";

const EMOJI = ["⭐", "🎮", "🕹️", "🏆", "🧩", "⚔️", "🚗", "🌲", "👾", "👥", "🛠️", "📚", "🔥", "💤", "🎵", "🧪"];

type Props = { state: CollectionsState; counts: Map<string, number>; onClose: () => void };

/** Create, rename, reorder, re-icon and delete collections. */
export function CollectionManager({ state, counts, onClose }: Props) {
  const t = useTranslation();
  const { collections, createCollection, renameCollection, moveCollection, deleteCollection } = state;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [deleting, setDeleting] = useState<Collection | null>(null);

  const submit = (event: FormEvent) => { event.preventDefault(); if (createCollection(name, icon)) { setName(""); setIcon(""); } };

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal collection-manager" role="dialog" aria-modal="true" aria-label="Manage collections" onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Escape" && !deleting) onClose(); }}>
      <div className="modal-header"><div><p className="eyebrow">Library</p><h2>Collections</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
      <form className="collection-create" onSubmit={submit}>
        <EmojiField value={icon} onChange={setIcon} label="New collection emoji" />
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New collection name" aria-label="New collection name" maxLength={40} autoFocus />
        <button type="submit" className="play-button" disabled={!name.trim()}>Create</button>
      </form>
      <ul className="collection-list">
        {collections.map((collection, index) => <li key={collection.id} className="collection-row">
          <EmojiField value={collection.icon ?? ""} onChange={(value) => renameCollection(collection.id, collection.name, value)} label={`Emoji for ${collection.name}`} />
          <input defaultValue={collection.name} aria-label={`Rename ${collection.name}`} maxLength={40} onBlur={(event) => { if (event.target.value.trim() && event.target.value !== collection.name) renameCollection(collection.id, event.target.value, collection.icon); else event.target.value = collection.name; }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <small>{t((counts.get(collection.id) ?? 0) === 1 ? "{count} game" : "{count} games").replace("{count}", String(counts.get(collection.id) ?? 0))}</small>
          <button type="button" className="icon-button" aria-label={`Move ${collection.name} up`} disabled={index === 0} onClick={() => moveCollection(collection.id, -1)}><ArrowUp size={14} /></button>
          <button type="button" className="icon-button" aria-label={`Move ${collection.name} down`} disabled={index === collections.length - 1} onClick={() => moveCollection(collection.id, 1)}><ArrowDown size={14} /></button>
          <button type="button" className="icon-button" aria-label={`Delete ${collection.name}`} onClick={() => setDeleting(collection)}><Trash2 size={14} /></button>
        </li>)}
        {!collections.length && <li className="metadata-note">No collections yet. Collections group games however you like, such as "Co-op" or "Finish this year".</li>}
      </ul>
    </div>
    {deleting && <ConfirmDialog title={`Delete “${deleting.name}”?`} message="Only the collection is removed. The games in it stay in your library." items={[deleting.name]} confirmLabel="Delete collection" danger
      onCancel={() => setDeleting(null)} onConfirm={() => { deleteCollection(deleting.id); setDeleting(null); }} />}
  </div>;
}

function EmojiField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(root, open, () => setOpen(false));
  return <div className="emoji-field" ref={root}>
    <button type="button" className="emoji-trigger" aria-label={`${label}: ${value || "none"}`} aria-expanded={open} onClick={() => setOpen(!open)}>{value || "☆"}</button>
    {open && <div className="emoji-popover" role="group" aria-label="Choose an emoji">
      {EMOJI.map((emoji) => <button type="button" key={emoji} aria-label={emoji} onClick={() => { onChange(emoji); setOpen(false); }}>{emoji}</button>)}
      <input aria-label="Type any emoji" placeholder="Any" maxLength={4} onChange={(event) => { onChange(event.target.value); }} />
      <button type="button" className="text-button" onClick={() => { onChange(""); setOpen(false); }}>None</button>
    </div>}
  </div>;
}
