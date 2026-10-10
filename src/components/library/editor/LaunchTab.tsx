import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle } from "lucide-react";
import { chooseGameAppBundle, chooseGameTarget, listInstalledFlatpaks, normalizeLaunchTarget, type FlatpakApp, type LaunchMethodId } from "../../../lib/platform";
import { Select } from "../../ui/Select";
import { LaunchOptionsSection } from "./LaunchOptionsSection";
import type { EditorContext } from "./types";

const methodOf = (target: string): LaunchMethodId => target.startsWith("flatpak://") ? "flatpak" : /\.app\/?$/i.test(target) ? "app" : "file";
const methodLabel = (method: string) => method === "file" ? "File or script" : method === "app" ? "macOS application" : method === "flatpak" ? "Flatpak" : "Custom";

export function LaunchTab({ ctx }: { ctx: EditorContext }) {
  const { draft, patch, capabilities } = ctx;
  const target = draft.executablePath ?? "";
  const [method, setMethod] = useState<LaunchMethodId>(methodOf(target));
  const [flatpaks, setFlatpaks] = useState<FlatpakApp[]>([]);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (method !== "flatpak" || flatpaks.length) return;
    void listInstalledFlatpaks().then(setFlatpaks).catch(() => {});
  }, [method, flatpaks.length]);

  // Warn when a path target no longer exists (skipped for URLs such as steam:// and flatpak://).
  useEffect(() => {
    setMissing(false);
    if (!target.startsWith("/")) return;
    let cancelled = false;
    void invoke<boolean[]>("check_launch_targets", { targets: [target] }).then((result) => { if (!cancelled) setMissing(result[0] === false); }).catch(() => {});
    return () => { cancelled = true; };
  }, [target]);

  const guarded = async (work: () => Promise<void>) => { try { setError(""); await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  const methods = (capabilities?.launchMethods ?? ["file", "flatpak", "custom"]).filter((item) => item !== "custom" || true);

  return <div className="form-fields editor-fields">
    <div className="editor-field"><span className="editor-field-label">Launch method</span>
      <Select<LaunchMethodId> label="Launch method" value={method} onChange={setMethod} options={methods.map((item) => ({ value: item as LaunchMethodId, label: methodLabel(item) }))} />
    </div>
    <label>Launch target
      <div className="flatpak-input-row">
        <input value={target} onChange={(event) => patch({ executablePath: event.target.value })} onBlur={() => patch({ executablePath: normalizeLaunchTarget(target, method) })} placeholder={method === "flatpak" ? "org.company.game" : "/path/to/game or steam://rungameid/…"} autoComplete="off" required />
        {method === "file" && <button type="button" className="secondary-button" onClick={() => void guarded(async () => { const picked = await chooseGameTarget(); if (picked) patch({ executablePath: picked }); })}>Choose file…</button>}
        {method === "app" && <button type="button" className="secondary-button" onClick={() => void guarded(async () => { const picked = await chooseGameAppBundle(); if (picked) patch({ executablePath: picked }); })}>Choose app…</button>}
      </div>
    </label>
    {method === "flatpak" && flatpaks.length > 0 && <div className="editor-field"><span className="editor-field-label">Installed Flatpaks</span>
      <Select<string> label="Installed Flatpak" placeholder="Pick an installed Flatpak" value={target.replace(/^flatpak:\/\//, "")} searchable
        onChange={(id) => patch({ executablePath: `flatpak://${id}` })}
        options={flatpaks.map((app) => ({ value: app.id, label: app.name, description: app.id, group: app.category }))} />
    </div>}
    {missing && <p className="auth-error editor-warning"><AlertTriangle size={13} /> Mochi can't find this file any more. Choose it again if it moved.</p>}
    <label>Install folder <small className="metadata-note">Optional. Lets Mochi follow the game's process to track playtime.</small>
      <div className="flatpak-input-row">
        <input value={draft.installPath ?? ""} onChange={(event) => patch({ installPath: event.target.value || undefined })} placeholder="/path/to/game" />
        <button type="button" className="secondary-button" onClick={() => void guarded(async () => { const picked = await open({ directory: true, multiple: false, title: "Choose install folder" }); if (typeof picked === "string") patch({ installPath: picked }); })}>Choose folder…</button>
      </div>
    </label>
    <LaunchOptionsSection key={ctx.draft.activeLaunchProfile ?? ""} ctx={ctx} />
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div>;
}
