import { useMemo, useState } from "react";
import { Download, Grid2X2, RefreshCw, Search } from "lucide-react";
import { MochiIcon } from "../components/MochiIcon";
import { useApp } from "../state/AppContext";
import { formatBytes, useInstalled } from "../components/installed/data";
import { TofuCard, updatesOf } from "../components/installed/TofuCard";
import { openPath } from "../lib/platform";

type Sort = "name" | "size" | "updates";
type Filter = "all" | "updates" | "disabled";

export function InstalledView() {
  const { lib, setActiveNav } = useApp();
  const installed = useInstalled(lib.library);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [filter, setFilter] = useState<Filter>("all");
  const { rows, progress, notice } = installed;
  const busy = progress !== null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => !q || `${row.piko.name} ${row.tofu.name} ${row.path}`.toLowerCase().includes(q))
      .filter((row) => filter === "all" || (filter === "updates" ? updatesOf(row).length > 0 : row.files.some((file) => !file.enabled)))
      .sort((a, b) => sort === "size" ? (b.size?.bytes ?? -1) - (a.size?.bytes ?? -1) || a.piko.name.localeCompare(b.piko.name)
        : sort === "updates" ? updatesOf(b).length - updatesOf(a).length || a.piko.name.localeCompare(b.piko.name)
        : a.piko.name.localeCompare(b.piko.name) || a.tofu.name.localeCompare(b.tofu.name));
  }, [rows, query, sort, filter]);
  const totalMods = rows.reduce((sum, row) => sum + row.files.length, 0);
  const totalBytes = rows.reduce((sum, row) => sum + (row.size?.bytes ?? 0), 0);
  const pending = rows.reduce((sum, row) => sum + updatesOf(row).length, 0);
  const loading = rows.some((row) => row.state === "loading");

  const manage = (key: string) => {
    const row = rows.find((item) => item.key === key);
    if (!row) return;
    lib.selectPiko(row.piko);
    lib.setSelectedTofuId(row.tofu.id);
    lib.setGameDetailsId(row.piko.id);
    setActiveNav("Library");
  };

  if (!rows.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><MochiIcon name="installed" fallback={Grid2X2} size={23} /></div>
        <h2>No mod folders yet</h2>
        <p>Give a Tofu a folder (open a game, then its Tofu settings) and Mochi will list its mods here, show disk usage and look for updates.</p>
        <button type="button" className="secondary-button" onClick={() => setActiveNav("Library")}>Open library</button>
      </div>
    );
  }

  return (
    <div className="inst-view">
      <div className="page-heading inst-heading">
        <div><p className="eyebrow">Mod control centre</p><h1>Installed</h1></div>
        <div className="inst-summary" aria-live="polite">{rows.length} Tofu{rows.length === 1 ? "" : "s"} · {totalMods} mods · {formatBytes(totalBytes)}{pending ? ` · ${pending} updates` : ""}</div>
      </div>
      <div className="inst-toolbar">
        <label className="search-box"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games and Tofus" aria-label="Search installed Tofus" /></label>
        <select className="compact-input" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter">
          <option value="all">All Tofus</option><option value="updates">With updates</option><option value="disabled">With disabled mods</option>
        </select>
        <select className="compact-input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
          <option value="name">Sort: name</option><option value="size">Sort: size</option><option value="updates">Sort: updates available</option>
        </select>
        <button type="button" className="secondary-button" onClick={() => void installed.checkAll()} disabled={busy || loading}><RefreshCw size={13} className={busy && progress?.label.startsWith("Checking") ? "spin" : ""} /> Check all for updates</button>
        {pending > 0 && <button type="button" className="secondary-button" onClick={() => void installed.updateAll()} disabled={busy}><Download size={13} /> Update all ({pending})</button>}
      </div>
      {progress && (
        <div className="inst-progress" role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <span>{progress.label} {progress.done} of {progress.total}</span><div className="stat-meter"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
        </div>
      )}
      {notice && !progress && <p className="stats-note" role="status">{notice}</p>}
      {visible.length ? (
        <ul className="inst-list">
          {visible.map((row) => (
            <TofuCard key={row.key} row={row} busy={busy}
              onCheck={() => void installed.check(row.key)} onUpdate={(mod) => void installed.updateOne(row.key, mod)} onUpdateAll={() => void installed.updateAll(row.key)}
              onOpen={() => void openPath(row.path).catch(() => installed.setNotice("Could not open that folder."))} onManage={() => manage(row.key)} />
          ))}
        </ul>
      ) : <p className="stats-muted inst-none">No Tofus match your search or filter.</p>}
    </div>
  );
}
