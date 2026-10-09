import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Gamepad2, RefreshCw, Rocket, Search } from "lucide-react";
import { launcherArt, launcherIcon } from "../../lib/launcherArt";
import minecraftGrassBlock from "../../assets/minecraft-grass-block.svg";
import { detectImportSources, scanImportGames, type DetectedImportSource, type ImportSourceId, type ImportedGame } from "../../lib/sources";

// The "Minecraft instances" source tile shows the game logo rather than the Prism launcher mark.
const sourceIcon = (id: string): string => (id === "prism" ? minecraftGrassBlock : launcherIcon(id));

export type PickerSelection = { games: ImportedGame[]; sources: ImportSourceId[] };

type Props = {
  /** Called whenever the checked games change. */
  onSelectionChange?: (selection: PickerSelection) => void;
  /** Rendered at the end of the sticky footer (e.g. the Import button). */
  renderAction?: (selection: PickerSelection) => ReactNode;
  /** Use these sources instead of detecting installed ones (manual library path). */
  sources?: DetectedImportSource[];
  scan?: (source: ImportSourceId) => Promise<ImportedGame[]>;
  /** Extra controls under the source list (e.g. "Platform not showing up?"). */
  sidebarExtra?: ReactNode;
  emptyHint?: ReactNode;
};

type SourceState = { status: "loading" | "ready" | "error"; games: ImportedGame[] };

const GAME_ROW = 56;
const HEADER_ROW = 34;
const OVERSCAN = 8;

type Row = { type: "header"; label: string; key: string } | { type: "game"; game: ImportedGame; key: string };

const keyOf = (game: ImportedGame) => `${game.source}\u0000${game.id}`;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function TriCheckbox({ checked, indeterminate, label, onChange }: { checked: boolean; indeterminate: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="sgp-check" checked={checked} aria-label={label} onChange={onChange} />;
}

export function SourceGamePicker({ onSelectionChange, renderAction, sources: fixedSources, scan, sidebarExtra, emptyHint }: Props) {
  const [detected, setDetected] = useState<DetectedImportSource[] | null>(fixedSources ?? null);
  const [detectError, setDetectError] = useState(false);
  const [data, setData] = useState<Record<string, SourceState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<ImportSourceId | null>(null);
  const [query, setQuery] = useState("");
  const [nonce, setNonce] = useState(0);
  const initialised = useRef<Set<string>>(new Set());

  const scanSource = scan ?? ((id: ImportSourceId) => scanImportGames(id));

  // Detect installed sources, hiding any with nothing to import.
  useEffect(() => {
    let cancelled = false;
    if (fixedSources) { setDetected(fixedSources); setActive((current) => current ?? fixedSources[0]?.id ?? null); return; }
    setDetected(null); setDetectError(false); setData({}); initialised.current = new Set();
    detectImportSources()
      .then((result) => {
        if (cancelled) return;
        const found = result.filter((source) => source.detected && (source.gameCount ?? 0) + (source.launcherCount ?? 0) > 0);
        setDetected(found);
        setActive(found[0]?.id ?? null);
      })
      .catch(() => { if (!cancelled) { setDetected([]); setDetectError(true); } });
    return () => { cancelled = true; };
  }, [fixedSources, nonce]);

  // Read every source's items up front so counts are exact and the footer total is right.
  const scanKey = detected?.map((source) => source.id).join(",") ?? "";
  useEffect(() => {
    if (!detected) return;
    let cancelled = false;
    detected.forEach((source) => {
      if (data[source.id]?.status === "ready") return;
      setData((current) => ({ ...current, [source.id]: { status: "loading", games: [] } }));
      scanSource(source.id).then((games) => {
        if (cancelled) return;
        setData((current) => ({ ...current, [source.id]: { status: "ready", games } }));
        if (!initialised.current.has(source.id)) {
          initialised.current.add(source.id);
          setSelected((current) => { const next = new Set(current); games.forEach((game) => next.add(keyOf(game))); return next; });
        }
      }).catch(() => { if (!cancelled) setData((current) => ({ ...current, [source.id]: { status: "error", games: [] } })); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanKey, nonce]);

  const retrySource = (id: ImportSourceId) => {
    setData((current) => ({ ...current, [id]: { status: "loading", games: [] } }));
    scanSource(id).then((games) => {
      setData((current) => ({ ...current, [id]: { status: "ready", games } }));
      initialised.current.add(id);
      setSelected((current) => { const next = new Set(current); games.forEach((game) => next.add(keyOf(game))); return next; });
    }).catch(() => setData((current) => ({ ...current, [id]: { status: "error", games: [] } })));
  };

  const selection = useMemo<PickerSelection>(() => {
    const games: ImportedGame[] = [];
    const ids: ImportSourceId[] = [];
    for (const source of detected ?? []) {
      const picked = (data[source.id]?.games ?? []).filter((game) => selected.has(keyOf(game)));
      if (picked.length) { games.push(...picked); ids.push(source.id); }
    }
    return { games, sources: ids };
  }, [detected, data, selected]);

  const onChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onSelectionChange;
  useEffect(() => { onChangeRef.current?.(selection); }, [selection]);

  const current = active ? data[active] : undefined;
  const activeSource = detected?.find((source) => source.id === active);

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    const visible = (current?.games ?? []).filter((game) => !needle || game.name.toLowerCase().includes(needle));
    const games = visible.filter((game) => game.kind !== "launcher");
    const launchers = visible.filter((game) => game.kind === "launcher");
    const out: Row[] = [];
    if (launchers.length && games.length) out.push({ type: "header", label: "Games", key: "h-games" });
    games.forEach((game) => out.push({ type: "game", game, key: keyOf(game) }));
    if (launchers.length) out.push({ type: "header", label: "Game launchers", key: "h-launchers" });
    launchers.forEach((game) => out.push({ type: "game", game, key: keyOf(game) }));
    return out;
  }, [current, query]);

  const offsets = useMemo(() => {
    const result: number[] = []; let y = 0;
    rows.forEach((row) => { result.push(y); y += row.type === "header" ? HEADER_ROW : GAME_ROW; });
    return { tops: result, total: y };
  }, [rows]);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [focusRow, setFocusRow] = useState(0);
  const pendingFocus = useRef(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => setViewport(el.clientHeight));
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [active, current?.status]);

  useEffect(() => { setScrollTop(0); setFocusRow(0); if (scroller.current) scroller.current.scrollTop = 0; }, [active, query]);

  const first = Math.max(0, offsets.tops.findIndex((top, index) => top + (rows[index].type === "header" ? HEADER_ROW : GAME_ROW) >= scrollTop) - OVERSCAN);
  let last = first;
  while (last < rows.length && offsets.tops[last] < scrollTop + viewport) last++;
  last = Math.min(rows.length, last + OVERSCAN);

  const moveFocus = useCallback((index: number) => {
    const target = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[target];
    if (!row) return;
    setFocusRow(target);
    pendingFocus.current = true;
    const el = scroller.current;
    if (el) {
      const top = offsets.tops[target];
      const height = row.type === "header" ? HEADER_ROW : GAME_ROW;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + height > el.scrollTop + el.clientHeight) el.scrollTop = top + height - el.clientHeight;
    }
  }, [rows, offsets]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    scroller.current?.querySelector<HTMLElement>(`[data-row="${focusRow}"]`)?.focus();
  });

  const toggle = (game: ImportedGame) => setSelected((currentSet) => {
    const next = new Set(currentSet);
    const key = keyOf(game);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const gamesOf = (id: ImportSourceId) => data[id]?.games ?? [];
  const toggleSource = (id: ImportSourceId) => setSelected((currentSet) => {
    const next = new Set(currentSet);
    const games = gamesOf(id);
    const all = games.length > 0 && games.every((game) => next.has(keyOf(game)));
    games.forEach((game) => (all ? next.delete(keyOf(game)) : next.add(keyOf(game))));
    return next;
  });

  const bulk = (mode: "all" | "none" | "invert") => setSelected((currentSet) => {
    const next = new Set(currentSet);
    rows.forEach((row) => {
      if (row.type !== "game") return;
      const has = next.has(row.key);
      if (mode === "all" || (mode === "invert" && !has)) next.add(row.key);
      else next.delete(row.key);
    });
    return next;
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = (direction: 1 | -1) => {
      let index = focusRow + direction;
      while (rows[index]?.type === "header") index += direction;
      if (rows[index]) moveFocus(index);
    };
    if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
    else if (event.key === "Home") { event.preventDefault(); moveFocus(rows.findIndex((row) => row.type === "game")); }
    else if (event.key === "End") { event.preventDefault(); moveFocus(rows.length - 1); }
    else if (event.key === "PageDown") { event.preventDefault(); moveFocus(focusRow + 8); }
    else if (event.key === "PageUp") { event.preventDefault(); moveFocus(focusRow - 8); }
  };

  const rescan = () => { initialised.current = new Set(); setSelected(new Set()); setData({}); setNonce((value) => value + 1); };
  const summary = `Import ${plural(selection.games.length, "game")} from ${plural(selection.sources.length, "source")}`;
  const focusable = rows[focusRow]?.type === "game" ? focusRow : rows.findIndex((row) => row.type === "game");

  if (detected === null) {
    return (
      <div className="sgp" aria-busy="true" aria-label="Scanning for game sources">
        <div className="sgp-sources">{[0, 1, 2, 3].map((n) => <div className="sgp-skeleton sgp-skeleton-source" key={n} />)}</div>
        <div className="sgp-detail">{[0, 1, 2, 3, 4, 5].map((n) => <div className="sgp-skeleton sgp-skeleton-game" key={n} />)}</div>
        <div className="sgp-footer"><span className="sgp-summary">Scanning for game sources…</span></div>
      </div>
    );
  }

  if (!detected.length) {
    return (
      <div className="sgp sgp-empty-all">
        <div className="sgp-empty" role={detectError ? "alert" : "status"}>
          {detectError ? <AlertTriangle size={22} /> : <Gamepad2 size={22} />}
          <strong>{detectError ? "Mochi could not scan for game sources." : "No games found to import."}</strong>
          <span>{detectError ? "Check that Mochi can read your home folder and try again." : "Mochi looked for Steam, Heroic, Lutris, Bottles, itch.io, Flatpak and desktop apps. You can add games manually at any time."}</span>
          {!fixedSources && <button type="button" className="secondary-button" onClick={rescan}><RefreshCw size={14} /> Scan again</button>}
          {emptyHint}
        </div>
        {sidebarExtra && <div className="sgp-extra">{sidebarExtra}</div>}
      </div>
    );
  }

  return (
    <div className="sgp">
      <div className="sgp-sources" role="list" aria-label="Detected game sources">
        {detected.map((source) => {
          const state = data[source.id];
          const games = state?.games ?? [];
          const picked = games.filter((game) => selected.has(keyOf(game))).length;
          const gameCount = games.filter((game) => game.kind !== "launcher").length;
          const launcherCount = games.length - gameCount;
          const counts = state?.status === "ready"
            ? [gameCount ? plural(gameCount, "game") : "", launcherCount ? plural(launcherCount, "launcher") : ""].filter(Boolean).join(" · ") || "Nothing to import"
            : state?.status === "error" ? "Could not read" : "Reading…";
          return (
            <div role="listitem" key={source.id} className={"sgp-source" + (source.id === active ? " active" : "")}>
              <TriCheckbox
                checked={games.length > 0 && picked === games.length}
                indeterminate={picked > 0 && picked < games.length}
                label={`Import everything from ${source.name}`}
                onChange={() => toggleSource(source.id)}
              />
              <button type="button" className="sgp-source-main" aria-current={source.id === active} onClick={() => setActive(source.id)}>
                <img className="sgp-source-icon" src={sourceIcon(source.id)} alt="" width={32} height={32} />
                <span className="sgp-source-copy"><strong>{source.name}</strong><small>{counts}</small></span>
                {state?.status === "ready" && <span className="sgp-badge" aria-label={`${picked} of ${games.length} selected`}>{picked}/{games.length}</span>}
              </button>
            </div>
          );
        })}
        {sidebarExtra && <div className="sgp-extra">{sidebarExtra}</div>}
      </div>

      <section className="sgp-detail" aria-label={activeSource ? `${activeSource.name} games` : "Games"}>
        {activeSource && (
          <>
            <div className="sgp-toolbar">
              <label className="sgp-search">
                <Search size={14} aria-hidden="true" />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${activeSource.name}`} aria-label={`Search ${activeSource.name}`} />
              </label>
              <div className="sgp-bulk" role="group" aria-label="Selection">
                <button type="button" className="text-button" onClick={() => bulk("all")}>All</button>
                <button type="button" className="text-button" onClick={() => bulk("none")}>None</button>
                <button type="button" className="text-button" onClick={() => bulk("invert")}>Invert</button>
              </div>
            </div>
            {current?.status === "loading" || !current ? (
              <div className="sgp-list" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((n) => <div className="sgp-skeleton sgp-skeleton-game" key={n} />)}</div>
            ) : current.status === "error" ? (
              <div className="sgp-empty" role="alert"><AlertTriangle size={20} /><strong>Could not read {activeSource.name}.</strong><button type="button" className="secondary-button" onClick={() => retrySource(activeSource.id)}><RefreshCw size={14} /> Try again</button></div>
            ) : !rows.length ? (
              <div className="sgp-empty" role="status"><Search size={20} /><strong>{query ? "No games match your search." : `${activeSource.name} has nothing to import.`}</strong></div>
            ) : (
              <div className="sgp-list" ref={scroller} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={onKeyDown} role="group" aria-label="Games to import">
                <div className="sgp-spacer" style={{ height: offsets.total }}>
                  {rows.slice(first, last).map((row, offset) => {
                    const index = first + offset;
                    const style = { transform: `translateY(${offsets.tops[index]}px)`, height: row.type === "header" ? HEADER_ROW : GAME_ROW };
                    if (row.type === "header") return <h3 className="sgp-group" style={style} key={row.key}>{row.label}</h3>;
                    const game = row.game;
                    const on = selected.has(row.key);
                    const isLauncher = game.kind === "launcher";
                    return (
                      <button
                        type="button" role="checkbox" aria-checked={on} key={row.key} data-row={index}
                        tabIndex={index === focusable ? 0 : -1} style={style}
                        className={"sgp-game" + (on ? " selected" : "")}
                        onFocus={() => setFocusRow(index)} onClick={() => toggle(game)}
                      >
                        <span className="sgp-box" aria-hidden="true">{on ? "✓" : ""}</span>
                        <span className={"sgp-thumb" + (isLauncher ? " launcher" : "")} aria-hidden="true">
                          {isLauncher ? <img src={launcherArt(game.launcherId)} alt="" loading="lazy" decoding="async" /> : <Gamepad2 size={16} />}
                        </span>
                        <span className="sgp-game-copy"><strong>{game.name}</strong><small>{isLauncher ? "Game launcher" : game.installPath || "Installed game"}</small></span>
                        {isLauncher && <Rocket size={14} aria-hidden="true" className="sgp-launcher-mark" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <div className="sgp-footer">
        <span className="sgp-summary" role="status">{summary}</span>
        {renderAction?.(selection)}
      </div>
    </div>
  );
}
