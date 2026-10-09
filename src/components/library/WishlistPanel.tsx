import { useState, type FormEvent } from "react";
import { Gift, Trash2 } from "lucide-react";
import { useWishlist, WISHLIST_LIMIT } from "../../lib/wishlist";
import { formatRelativeTime } from "../../lib/format";

/** Games you want but do not own yet. Local to this device. */
export function WishlistPanel() {
  const { items, add, remove, update } = useWishlist();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const full = items.length >= WISHLIST_LIMIT;
  const submit = (event: FormEvent) => { event.preventDefault(); if (add({ name, note: note.trim() || undefined, source: "manual" })) { setName(""); setNote(""); } };
  return <section className="wishlist-panel" aria-label="Wishlist">
    <div className="section-heading"><div><p className="eyebrow">Not owned yet</p><h3>Wishlist</h3></div><span className="category-count">{items.length} game{items.length === 1 ? "" : "s"}</span></div>
    <form className="wishlist-add" onSubmit={submit}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Game name" aria-label="Game name" maxLength={120} disabled={full} />
      <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note (optional)" aria-label="Note" maxLength={280} disabled={full} />
      <button type="submit" className="play-button" disabled={!name.trim() || full}>Add game</button>
    </form>
    {items.length === 0
      ? <div className="empty-state wishlist-empty"><div className="empty-icon"><Gift size={22} /></div><h2>Your wishlist is empty.</h2><p>Add games you want to buy or try later. They stay on this device.</p></div>
      : <ul className="wishlist-list">{items.map((item) => <li className="wishlist-row" key={item.id}>
        {item.coverUrl ? <img className="wishlist-cover" src={item.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="wishlist-cover placeholder" aria-hidden="true"><Gift size={16} /></span>}
        <div className="wishlist-copy"><strong>{item.name}</strong><small>Added {formatRelativeTime(item.addedAt / 1000)}{item.source && item.source !== "manual" ? ` · ${item.source.toUpperCase()}` : ""}</small></div>
        <input className="wishlist-note" defaultValue={item.note ?? ""} placeholder="Add a note" aria-label={`Note for ${item.name}`} maxLength={280}
          onBlur={(event) => { if (event.target.value.trim() !== (item.note ?? "")) update(item.id, { note: event.target.value.trim() || undefined }); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        <button type="button" className="icon-button" aria-label={`Remove ${item.name} from wishlist`} onClick={() => remove(item.id)}><Trash2 size={14} /></button>
      </li>)}</ul>}
  </section>;
}
