import { useState } from "react";
import { Gift, Settings2, Tag } from "lucide-react";
import type { Collection } from "../../models";
import { smartFilters, type LibraryFilter } from "../../lib/library";
import type { LibraryState } from "../../state/useLibrary";

type Props = {
  lib: LibraryState;
  collections: Collection[];
  tags: Array<[string, number]>;
  onManageCollections: () => void;
  /** The Wishlist chip: games not owned yet. While active, the library grid is replaced by the wishlist. */
  wishlist?: { active: boolean; count: number; onToggle: () => void };
};

const same = (a: LibraryFilter, b: LibraryFilter) => a.kind === b.kind && a.id === b.id;

/** Smart-filter chips with live counts, sources, collections and multi-select tags. */
export function LibraryFilterBar({ lib, collections, tags, onManageCollections, wishlist }: Props) {
  const { filter, setFilter, filterCounts, tagFilters, toggleTagFilter, setTagFilters } = lib;
  const [showTags, setShowTags] = useState(tagFilters.length > 0);

  const chip = (target: LibraryFilter, label: string, count: number, key: string) => {
    const active = same(filter, target) && !wishlist?.active;
    return <button type="button" key={key} className={`filter-chip ${active ? "active" : ""}`} aria-pressed={active} onClick={() => { setFilter(target); if (wishlist?.active) wishlist.onToggle(); }}>
      <span>{label}</span><span className="filter-count">{count}</span>
    </button>;
  };

  return <section className="library-filters" aria-label="Library filters">
    <div className="filter-row" role="group" aria-label="Smart filters">
      {smartFilters.map(({ id, label }) => chip({ kind: "smart", id }, label, filterCounts.smart[id] ?? 0, `smart-${id}`))}
    </div>
    {(filterCounts.sources.length > 1 || collections.length > 0) && <div className="filter-row" role="group" aria-label="Sources and collections">
      {filterCounts.sources.length > 1 && filterCounts.sources.map((source) => chip({ kind: "source", id: source.id }, source.label, source.count, `source-${source.id}`))}
      {collections.map((collection) => chip({ kind: "collection", id: collection.id }, `${collection.icon ? collection.icon + " " : ""}${collection.name}`, filterCounts.collections.get(collection.id) ?? 0, `col-${collection.id}`))}
    </div>}
    <div className="filter-row filter-actions">
      {wishlist && <button type="button" className={`filter-chip ${wishlist.active ? "active" : ""}`} aria-pressed={wishlist.active} onClick={wishlist.onToggle}><Gift size={13} /><span>Wishlist</span><span className="filter-count">{wishlist.count}</span></button>}
      <button type="button" className="text-button" onClick={onManageCollections}><Settings2 size={13} /> Collections</button>
      {tags.length > 0 && <button type="button" className={`text-button ${tagFilters.length ? "has-active" : ""}`} aria-expanded={showTags} onClick={() => setShowTags(!showTags)}><Tag size={13} /> Tags{tagFilters.length ? ` (${tagFilters.length})` : ""}</button>}
      {tagFilters.length > 0 && <button type="button" className="text-button" onClick={() => setTagFilters([])}>Clear tags</button>}
    </div>
    {showTags && tags.length > 0 && <div className="filter-row tag-filter-row" role="group" aria-label="Filter by tag (all selected tags must match)">
      {tags.map(([tag, count]) => <button type="button" key={tag} className={`filter-chip tag ${tagFilters.includes(tag) ? "active" : ""}`} aria-pressed={tagFilters.includes(tag)} onClick={() => toggleTagFilter(tag)}><span>#{tag}</span><span className="filter-count">{count}</span></button>)}
    </div>}
  </section>;
}
