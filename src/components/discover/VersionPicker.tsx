import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { groupVersions, latestRelease, pinnedVersions, type GameVersion } from "../../lib/gameVersions";
import { usePopoverPlacement } from "../ui/usePopoverPlacement";
import { useDismiss } from "../ui/useDismiss";

type Row = { id: string; value: string; label: string; hint?: string; heading?: string };

const SNAPSHOT_RENDER_CAP = 120;

type Props = {
  value: string;
  onChange: (version: string) => void;
  versions: GameVersion[];
  loading?: boolean;
  label?: string;
  className?: string;
};

/**
 * Minecraft version dropdown: search, "All versions", "Latest release", recent/most-used
 * pins, releases grouped by major line, and snapshots only when asked for.
 */
export function VersionPicker({ value, onChange, versions, loading, label = "Minecraft version", className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [snapshots, setSnapshots] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { placement, maxHeight } = usePopoverPlacement(open, root, 380);
  const latest = useMemo(() => latestRelease(versions), [versions]);

  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    const needle = query.trim();
    if (!needle) {
      result.push({ id: "all", value: "", label: "All versions" });
      if (latest) result.push({ id: "latest", value: latest.id, label: "Latest release", hint: latest.id });
      const pinned = pinnedVersions(versions).filter((version) => snapshots || version.kind === "release");
      pinned.forEach((version, index) => result.push({ id: `pin-${version.id}`, value: version.id, label: version.id, heading: index === 0 ? "Recent and most used" : undefined }));
    }
    for (const group of groupVersions(versions, { includeSnapshots: snapshots, query: needle })) {
      const capped = !needle && group.versions[0]?.kind !== "release" ? group.versions.slice(0, SNAPSHOT_RENDER_CAP) : group.versions;
      capped.forEach((version, index) => result.push({ id: `v-${version.id}`, value: version.id, label: version.id, heading: index === 0 ? group.title : undefined }));
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` restarts the list each time the menu opens
  }, [versions, query, snapshots, latest, open]);

  useDismiss(root, open, () => setOpen(false));

  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-centre on the chosen row only when the menu opens or the filter changes, not on every keystroke of the highlight
  useEffect(() => { if (open) setActive(Math.max(0, rows.findIndex((row) => row.value === value && row.id !== "latest"))); }, [open, query, snapshots]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onChange(row.value);
    setOpen(false);
    setQuery("");
    root.current?.querySelector<HTMLElement>(".mochi-select-trigger")?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    else if (event.key === "ArrowDown") { event.preventDefault(); if (!open) setOpen(true); else setActive((index) => Math.min(rows.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); if (!open) setOpen(true); else setActive((index) => Math.max(0, index - 1)); }
    else if (event.key === "Enter" && open && (event.target as HTMLElement).tagName !== "BUTTON") { event.preventDefault(); choose(rows[active]); }
    else if (event.key === "Tab") setOpen(false);
  };

  const shown = value ? value : "All versions";
  return <div ref={root} className={`mochi-select version-picker ${open ? "open" : ""} ${className}`.trim()} data-placement={placement} onKeyDown={onKeyDown}>
    <button type="button" className="mochi-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={`${label}: ${shown}`} onClick={() => setOpen((current) => !current)}>
      <span className="mochi-select-value">{shown}</span>
      <ChevronDown size={15} className="mochi-select-chevron" aria-hidden="true" />
    </button>
    {open && <div className="mochi-select-popover version-picker-popover" style={{ maxHeight }}>
      <label className="mochi-select-search"><Search size={14} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search versions…" aria-label="Search Minecraft versions" /></label>
      <label className="version-picker-switch"><input type="checkbox" role="switch" checked={snapshots} onChange={(event) => setSnapshots(event.target.checked)} /><span>Include snapshots</span><small>Pre-releases, release candidates, April Fools</small></label>
      <div ref={list} id={listId} className="mochi-select-list" role="listbox" aria-label={label} aria-activedescendant={`${listId}-${active}`}>
        {loading && !versions.length && <div className="mochi-select-empty">Loading versions…</div>}
        {rows.map((row, index) => <div key={row.id} role="presentation">
          {row.heading && <div className="mochi-select-group" role="presentation">{row.heading}</div>}
          <div id={`${listId}-${index}`} role="option" data-index={index} aria-selected={row.value === value && row.id !== "latest"} className={`mochi-select-option ${index === active ? "active" : ""} ${row.value === value && row.id !== "latest" ? "selected" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(row)}>
            <span className="mochi-select-option-copy"><span>{row.label}</span>{row.hint && <small>{row.hint}</small>}</span>
            {row.value === value && row.id !== "latest" && <Check size={14} aria-hidden="true" />}
          </div>
        </div>)}
        {!loading && !rows.length && <div className="mochi-select-empty">{query ? `No version matches “${query}”.` : "No versions available."}</div>}
        {!query && !snapshots && versions.length > 0 && <div className="mochi-select-empty version-picker-note">Snapshots are hidden. Turn on “Include snapshots” to see them.</div>}
      </div>
    </div>}
  </div>;
}
