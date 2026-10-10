import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, FolderOpen, RefreshCw, ScrollText, Search, Trash2, X } from "lucide-react";
import { appendLog, clearGameLogs, handoffHelp, listGameLogs, readGameLog, type LogList } from "../lib/gameLogs";
import { formatBytes } from "../lib/format";
import { openPath } from "../lib/platform";
import type { Piko } from "../models";
import { useApp } from "../state/AppContext";
import { ModalShell } from "./mods/ModalShell";
import { ConflictIssues } from "./mods/ConflictIssues";
import { findCrashSuspects } from "../lib/mods/conflictService";
import type { Issue } from "../lib/mods/conflicts";
import { confirmAction } from "../lib/confirm";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "That did not work.");

/** "Logs" button for a game page and the viewer it opens: per-session output of the game, tail/follow, copy, clear, open folder. */
export function GameLogsButton({ game }: { game: Piko }) {
  const { sessions } = useApp();
  const running = sessions.isRunning(game.id);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listGameLogs(game.id).then((logs) => {
      if (!cancelled) setAvailable(running || logs.sessions.some((session) => session.direct));
    }).catch(() => { if (!cancelled) setAvailable(running); });
    return () => { cancelled = true; };
  }, [game.id, running]);

  // Do not advertise a logs viewer when this game has no captured sessions and is not running under Mochi.
  if (!available) return null;
  return <>
    <button type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => setOpen(true)}><ScrollText size={14} /> Logs</button>
    {open && <GameLogsModal game={game} onClose={() => setOpen(false)} />}
  </>;
}

function GameLogsModal({ game, onClose }: { game: Piko; onClose: () => void }) {
  const { sessions, platformCapabilities } = useApp();
  const running = sessions.isRunning(game.id);
  const [list, setList] = useState<LogList | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [text, setText] = useState("");
  const [follow, setFollow] = useState(running);
  const [message, setMessage] = useState("");
  const [suspects, setSuspects] = useState<Issue[] | null>(null);
  const offset = useRef<number | undefined>(undefined);
  const view = useRef<HTMLPreElement>(null);
  const current = list?.sessions.find((item) => item.id === sessionId);
  const modTofu = game.tofus.find((tofu) => tofu.path);
  const platform = platformCapabilities?.platform ?? "linux";

  const loadList = useCallback(async () => {
    try {
      const next = await listGameLogs(game.id);
      setList(next);
      setSessionId((previous) => (next.sessions.some((item) => item.id === previous) ? previous : next.sessions.find((item) => item.direct)?.id ?? next.sessions[0]?.id ?? ""));
    } catch (error) { setMessage(errorText(error)); setList({ dir: "", sessions: [] }); }
  }, [game.id]);
  useEffect(() => { void loadList(); }, [loadList]);

  const read = useCallback(async () => {
    if (!sessionId) return;
    try {
      const chunk = await readGameLog(game.id, sessionId, offset.current);
      offset.current = chunk.offset;
      if (chunk.text || chunk.reset || chunk.cutStart) setText((previous) => appendLog(previous, chunk));
    } catch (error) { setMessage(errorText(error)); }
  }, [game.id, sessionId]);

  // A newly chosen session starts from its newest part; following then continues from where the last read ended.
  useEffect(() => { offset.current = undefined; setText(""); void read(); }, [sessionId, read]);
  useEffect(() => {
    if (!follow || !sessionId) return;
    const timer = window.setInterval(() => { if (!document.hidden) void read(); }, 1000);
    return () => window.clearInterval(timer);
  }, [follow, sessionId, read]);
  useEffect(() => { if (follow && view.current) view.current.scrollTop = view.current.scrollHeight; }, [text, follow]);

  useEffect(() => { setSuspects(null); }, [sessionId]);
  const findSuspects = useCallback(async () => {
    if (modTofu) setSuspects(await findCrashSuspects(game, modTofu, text));
  }, [game, modTofu, text]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMessage("Copied to the clipboard."); }
    catch { setMessage("Could not copy. Select the text and copy it by hand."); }
  };
  const clear = async () => {
    const count = list?.sessions.length ?? 0;
    if (!await confirmAction({ title: `Clear logs for ${game.name}?`, danger: true, confirmLabel: "Clear logs", message: "Captured output is deleted from this computer. This cannot be undone.", items: [`${count} saved log session${count === 1 ? "" : "s"}`] })) return;
    try { const count = await clearGameLogs(game.id); setMessage(`Removed ${count} log${count === 1 ? "" : "s"}.`); setText(""); offset.current = undefined; await loadList(); }
    catch (error) { setMessage(errorText(error)); }
  };

  const empty = !current;
  return <ModalShell label={`${game.name} logs`} className="modal game-logs-modal" onClose={onClose}>
    <div className="modal-header"><div><p className="eyebrow">{game.name}</p><h2>Game logs</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
    <div className="game-logs-toolbar">
      <label>Session
        <select className="compact-input" value={sessionId} onChange={(event) => setSessionId(event.target.value)} disabled={empty} aria-label="Log session">
          {list?.sessions.map((item) => <option key={item.id} value={item.id}>{when(item.startedAt)} · {item.direct ? formatBytes(item.size) : "not captured"}</option>)}
          {empty && <option value="">No sessions yet</option>}
        </select>
      </label>
      <label className="check-row"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> Follow</label>
      <button type="button" className="secondary-button" onClick={() => { void loadList(); void read(); }}><RefreshCw size={13} /> Refresh</button>
      <button type="button" className="secondary-button" onClick={() => void copy()} disabled={!text}><Copy size={13} /> Copy</button>
      {modTofu && <button type="button" className="secondary-button" onClick={() => void findSuspects()} disabled={!text} title="Looks in this log for the mods it names"><Search size={13} /> Find suspect mods</button>}
      <button type="button" className="secondary-button" onClick={() => list?.dir && void openPath(list.dir).catch((error) => setMessage(errorText(error)))} disabled={!list?.dir}><FolderOpen size={13} /> Open folder</button>
      <button type="button" className="secondary-button danger-outline" onClick={() => void clear()} disabled={empty}><Trash2 size={13} /> Clear</button>
    </div>
    {message && <p className="metadata-note" role="status">{message}</p>}
    {suspects && modTofu && (suspects.length
      ? <ConflictIssues issues={suspects} tofu={modTofu} onFixed={async () => setSuspects(await findCrashSuspects(game, modTofu, text))} />
      : <p className="metadata-note" role="status">No installed mod is named in this log.</p>)}
    {empty ? <p className="muted game-logs-empty">{running ? "The game is running but no log was captured for it." : "Nothing has been captured yet. Start the game from Mochi and its output appears here."}</p>
      : !current.direct ? <p className="muted game-logs-empty" role="status">{handoffHelp(platform)}</p>
      : <pre className="game-logs-view" ref={view} tabIndex={0} aria-label="Log output">{text || (running ? "Waiting for output..." : "This session wrote no output.")}</pre>}
    <small className="metadata-note">Logs stay on this computer, the newest 8 sessions per game are kept and very long logs are shortened.</small>
  </ModalShell>;
}
