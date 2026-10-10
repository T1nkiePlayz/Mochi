import { useCallback, useEffect, useState } from "react";
import { FolderOpen, RefreshCw, RotateCcw, Trash2, Wrench } from "lucide-react";
import { confirmAction } from "../../../lib/confirm";
import { subscribeNative } from "../../../lib/nativeEvents";
import { openPath } from "../../../lib/platform";
import { deletePrefixBackup, describePrefix, getPrefixInfo, resetPrefix, restorePrefix, runPrefixTool, type PrefixDone, type PrefixInfo, type PrefixTool } from "../../../lib/prefixes";
import { getDirSize } from "../../installed/data";
import { Select } from "../../ui/Select";

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "That did not work.");

/** The game's private Wine/Proton prefix: where it is, how big, repair and install tools, and a reset that keeps the old copy. */
export function PrefixManager({ gameId, tofuId, gameName, runtime }: { gameId: string; tofuId?: string; gameName: string; runtime?: string }) {
  const [info, setInfo] = useState<PrefixInfo | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [verb, setVerb] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getPrefixInfo(gameId, tofuId);
      setInfo(next);
      setBytes(null);
      if (next.exists) void getDirSize(next.path).then((size) => setBytes(size.bytes)).catch(() => undefined);
    } catch { setInfo(null); }
  }, [gameId, tofuId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeNative<PrefixDone>("prefix-tool-done", (done) => {
    if (done.gameId !== gameId) return;
    setWorking(false);
    setMessage(done.message);
    void load();
  }), [gameId, load]);

  if (!info?.supported) return null;
  const busy = working || info.busy;
  const guard = async (work: () => Promise<unknown>, done: string) => {
    setMessage("");
    try { await work(); setMessage(done); } catch (error) { setMessage(errorText(error)); }
    await load();
  };
  const tool = (name: PrefixTool, label: string, chosen?: string) => {
    const waits = name === "wineboot" || name === "winetricks";
    setMessage("");
    if (waits) setWorking(true);
    runPrefixTool(gameId, tofuId, runtime, name, chosen).then(() => setMessage(waits ? `${label} started. You will be told when it finishes.` : `${label} opened.`)).catch((error) => { setWorking(false); setMessage(errorText(error)); });
  };
  const reset = async () => {
    if (!await confirmAction({ title: `Reset the Windows prefix for ${gameName}?`, danger: true, confirmLabel: "Reset prefix", message: "The current prefix is set aside as an old copy and the game starts with a fresh one next time. Game settings stored inside the prefix (and some saves) go with it, and you can restore the old copy afterwards.", items: [info.path] })) return;
    await guard(() => resetPrefix(gameId, tofuId), "Prefix reset. The old copy is kept.");
  };

  return <div className="editor-field prefix-manager" role="group" aria-label="Windows prefix">
    <span className="editor-field-label">Windows prefix</span>
    <code className="launch-command" tabIndex={0}>{info.path}</code>
    <small className="launch-hint">{describePrefix(info, bytes)}{info.hasBackup ? " · an old copy is kept" : ""}</small>
    <div className="launch-profile-row">
      <button type="button" className="secondary-button" disabled={!info.exists} onClick={() => void openPath(info.path).catch((error) => setMessage(errorText(error)))}><FolderOpen size={13} /> Open folder</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => tool("winecfg", "Wine settings")}><Wrench size={13} /> Wine settings</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => tool("regedit", "Registry editor")}>Registry</button>
      <button type="button" className="secondary-button" disabled={busy} title="Updates the prefix to the runtime's version (wineboot -u). Try it when a game stops starting after a runtime change." onClick={() => tool("wineboot", "Repair")}><RefreshCw size={13} className={busy ? "spin" : undefined} /> Repair</button>
    </div>
    <div className="launch-profile-row">
      <Select label="Component to install" value={verb} onChange={setVerb} searchable={false} options={[{ value: "", label: "Install a component…" }, ...info.verbs.map((item) => ({ value: item.id, label: item.label, description: item.id }))]} />
      <button type="button" className="secondary-button" disabled={busy || !verb || !info.hasWinetricks} onClick={() => tool("winetricks", info.verbs.find((item) => item.id === verb)?.label ?? verb, verb)}>Install</button>
    </div>
    {!info.hasWinetricks && <small className="launch-hint">Installing components needs winetricks (install it with your package manager).</small>}
    <div className="launch-profile-row">
      <button type="button" className="secondary-button danger-outline" disabled={busy || !info.exists} onClick={() => void reset()}><RotateCcw size={13} /> Reset prefix…</button>
      {info.hasBackup && <button type="button" className="secondary-button" disabled={busy} onClick={() => void guard(() => restorePrefix(gameId, tofuId), "Old copy restored. The replaced prefix is kept as the old copy.")}>Restore old copy</button>}
      {info.hasBackup && <button type="button" className="icon-button" aria-label="Delete the old prefix copy" disabled={busy} onClick={() => void (async () => { if (await confirmAction({ title: "Delete the old prefix copy?", danger: true, confirmLabel: "Delete", message: "The old copy is removed from this computer. This cannot be undone.", items: [`${info.path}.old`] })) await guard(() => deletePrefixBackup(gameId, tofuId), "Old copy deleted."); })()}><Trash2 size={14} /></button>}
    </div>
    <p className="metadata-note" role="status" aria-live="polite">{message}</p>
  </div>;
}
