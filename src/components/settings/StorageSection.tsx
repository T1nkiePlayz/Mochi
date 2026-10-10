import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FolderOpen } from "lucide-react";
import { Select, type SelectOption } from "../ui/Select";
import { useApp } from "../../state/AppContext";
import { confirmAction } from "../../lib/confirm";
import { formatBytes } from "../../lib/format";
import { useStorageScan } from "../../lib/useStorageScan";
import { ageLabel, ageOptions, buildRows, categoryLabels, clearActions, clearAllUnused, clearStorageLocation, formatShare, openFolder, sortRows, summarise, visibleRows, type SortKey, type SortState, type StorageRow } from "../../lib/diskUsage";
import { SettingsGroup } from "./Section";

const PAGE = 200;
const columns: Array<{ key: SortKey; label: string }> = [{ key: "name", label: "Name" }, { key: "category", label: "Kind" }, { key: "bytes", label: "Size" }];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function SizeCell({ row, max }: { row: StorageRow; max: number }) {
  const size = row.measurement;
  if (!size) return <span className="storage-skeleton" aria-label="Measuring" />;
  if (size.error) return <span className="storage-error" title={size.error}>Unavailable</span>;
  const width = max > 0 ? Math.max(size.bytes > 0 ? 2 : 0, (size.bytes / max) * 100) : 0;
  return <span className="storage-size" title={size.truncated ? "A very large folder: this is a lower bound." : `${size.files.toLocaleString()} files`}>
    <span className="storage-size-bar" aria-hidden="true"><span className={`storage-fill storage-cat-${row.category}`} style={{ width: `${width}%` }} /></span>
    <span>{size.truncated ? "≥ " : ""}{formatBytes(size.bytes)}{!size.done && " …"}</span>
  </span>;
}

export function StorageSection() {
  const { lib } = useApp();
  const { locations, measurements, scanning, started, error, scan, cancel } = useStorageScan(lib.library);
  const [sort, setSort] = useState<SortState>({ key: "bytes", dir: "desc" });
  const [limit, setLimit] = useState(PAGE);
  const [age, setAge] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const rows = useMemo(() => buildRows(locations, measurements), [locations, measurements]);
  const totals = useMemo(() => summarise(rows), [rows]);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const { shown, hidden } = visibleRows(sorted, limit);
  const max = useMemo(() => rows.reduce((best, row) => (row.measurement && !row.measurement.error ? Math.max(best, row.measurement.bytes) : best), 0), [rows]);
  const ageOption = useMemo<Array<SelectOption<string>>>(() => ageOptions.map((days) => ({ value: String(days), label: `Older than ${ageLabel(days)}` })), []);
  const sortBy = (key: SortKey) => setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "bytes" ? "desc" : "asc" }));
  const sizeOf = (category: string) => totals.categories.find((item) => item.category === category)?.bytes ?? 0;

  const clear = async (action: (typeof clearActions)[number]) => {
    const present = formatBytes(sizeOf(action.category));
    const scope = action.needsAge ? ` older than ${ageLabel(age)}` : "";
    const ok = await confirmAction({ title: `${action.label}?`, danger: action.danger, confirmLabel: "Remove", message: `${action.detail} This cannot be undone. Game installs and your own mod folders are never touched here.`,
      items: [`${categoryLabels[action.category]}${scope}${started && totals.measured ? ` (up to ${present} now)` : ""}`] });
    if (!ok) return;
    setBusy(action.kind); setNote("");
    try {
      const result = await clearStorageLocation(action.kind, action.needsAge ? age : undefined);
      setNote(result.files ? `Removed ${result.files.toLocaleString()} file${result.files === 1 ? "" : "s"} and freed ${formatBytes(result.bytes)}.` : "There was nothing to remove.");
      void scan();
    } catch (cause) { setNote(errorText(cause)); }
    finally { setBusy(null); }
  };
  const clearAll = async () => {
    const ok = await confirmAction({ title: "Clear all unused data?", danger: true, confirmLabel: "Clear everything", message: `Removes every cache and leftover Mochi keeps: artwork cache, unfinished downloads, game logs, and rollback copies and snapshots older than ${ageLabel(age)}. This cannot be undone. Game installs, your own mod folders, covers you picked yourself and anything in use are never touched.`,
      items: clearActions.map((action) => action.needsAge ? `${action.label} (older than ${ageLabel(age)})` : action.label) });
    if (!ok) return;
    setBusy("all"); setNote("");
    try {
      const result = await clearAllUnused(age);
      const done = result.files ? `Removed ${result.files.toLocaleString()} file${result.files === 1 ? "" : "s"} and freed ${formatBytes(result.bytes)}.` : "There was nothing to remove.";
      setNote(result.failed.length ? `${done} Could not clear: ${result.failed.join(", ")}.` : done);
      void scan();
    } finally { setBusy(null); }
  };
  const open = (path: string) => { void openFolder(path).catch((cause) => setNote(errorText(cause))); };

  return <SettingsGroup title="Storage" subtitle="Where disk space goes" id="settings-storage" className="storage-group">
    <div className="storage-summary">
      <span>
        <strong className="storage-total">{started ? formatBytes(totals.total) : "Not measured yet"}</strong>
        <small role="status">{!started ? "Measuring reads folder sizes only and can take a while for big libraries, so it runs when you ask." : scanning ? `Measuring… ${totals.measured + totals.failed} of ${locations.length || "?"} locations done.` : `${totals.measured} location${totals.measured === 1 ? "" : "s"} measured${totals.failed ? `, ${totals.failed} unavailable` : ""}.`}</small>
      </span>
      <span className="storage-summary-actions">
        {scanning && <button type="button" className="secondary-button" onClick={cancel}>Stop</button>}
        <button type="button" className="secondary-button" disabled={scanning} onClick={() => void scan()}>{started ? "Scan again" : "Measure disk usage"}</button>
      </span>
    </div>
    {error && <p className="metadata-note settings-note" role="alert">{error}</p>}
    {started && <>
      <div className="storage-bar" role="img" aria-label={`Storage by kind: ${totals.categories.map((item) => `${categoryLabels[item.category]} ${formatBytes(item.bytes)}`).join(", ") || "nothing measured yet"}`}>
        {totals.categories.map((item) => <span key={item.category} className={`storage-segment storage-cat-${item.category}`} style={{ flexGrow: item.bytes }} title={`${categoryLabels[item.category]}: ${formatBytes(item.bytes)}`} />)}
      </div>
      <ul className="storage-legend" aria-label="Kinds">
        {totals.categories.map((item) => <li key={item.category}><span className={`storage-dot storage-cat-${item.category}`} aria-hidden="true" />{categoryLabels[item.category]}<small>{formatBytes(item.bytes)}</small></li>)}
      </ul>
      <div className="storage-table-wrap">
        <table className="storage-table">
          <thead><tr>
            {columns.map((column) => <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
              <button type="button" className="storage-sort" onClick={() => sortBy(column.key)}>{column.label}{sort.key === column.key && (sort.dir === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}</button>
            </th>)}
            <th scope="col" className="storage-share-col">Share</th>
            <th scope="col"><span className="visually-hidden">Actions</span></th>
          </tr></thead>
          <tbody>
            {locations.length === 0 && [0, 1, 2, 3].map((index) => <tr key={index}><td colSpan={5}><span className="storage-skeleton storage-skeleton-row" /></td></tr>)}
            {shown.map((row) => <tr key={row.key}>
              <td className="storage-name"><strong>{row.name}</strong>{row.inside && <small>Included in {categoryLabels[row.inside]}</small>}</td>
              <td>{categoryLabels[row.category]}</td>
              <td><SizeCell row={row} max={max} /></td>
              <td className="storage-share-col">{row.inside ? "" : formatShare(row.measurement && !row.measurement.error ? row.measurement.bytes : null, totals.total)}</td>
              <td className="storage-row-actions">{row.path && <button type="button" className="secondary-button storage-open" onClick={() => open(row.path!)} aria-label={`Open folder of ${row.name}`}><FolderOpen size={14} aria-hidden="true" />Open</button>}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {hidden > 0 && <div className="storage-more"><button type="button" className="secondary-button" onClick={() => setLimit((current) => current + PAGE)}>Show {Math.min(PAGE, hidden)} more ({hidden.toLocaleString()} hidden)</button></div>}
      <small className="metadata-note storage-note">Game installs and mod folders can only be opened here, never deleted. Sizes of nested folders can overlap, and very large folders are measured up to a limit.</small>
    </>}
    <div className="setting-row storage-clear-head"><span><strong>Free up space</strong><small>Only Mochi's own caches and leftovers can be removed here.</small></span><Select value={String(age)} onChange={(value) => setAge(Number(value))} options={ageOption} label="Age for old items" className="storage-age" /></div>
    <div className="setting-row"><span><strong>Clear all unused data</strong><small>Runs every action below at once, using the age chosen above.</small></span>
      <button type="button" className="secondary-button danger-outline" disabled={busy !== null || scanning} onClick={() => void clearAll()}>{busy === "all" ? "Clearing…" : "Clear all"}</button></div>
    {clearActions.map((action) => <div className="setting-row" key={action.kind}>
      <span><strong>{action.label}{action.needsAge ? ` (older than ${ageLabel(age)})` : ""}</strong><small>{action.detail}</small></span>
      <button type="button" className="secondary-button danger-outline" disabled={busy !== null || scanning} onClick={() => void clear(action)}>{busy === action.kind ? "Removing…" : "Remove"}</button>
    </div>)}
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
  </SettingsGroup>;
}
