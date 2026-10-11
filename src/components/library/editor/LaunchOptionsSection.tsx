import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Copy, FolderOpen, Plus, Trash2 } from "lucide-react";
import { listLaunchRuntimes, previewLaunchCommand, type LaunchPreview, type RuntimeInfo } from "../../../lib/platform";
import { formatArgs, parseArgs, runtimeIdOf } from "../../../lib/launch";
import { addEnvRow, duplicateEnvNames, envNameError, removeEnvRow, setEnvRow, updateLaunchOptions } from "../../../lib/launchOptionsState";
import { launchTargetFor } from "../../../lib/minecraftPiko";
import type { LaunchOptions } from "../../../models";
import { activeLaunchProfile, addLaunchProfile, effectiveLaunchOptions, MAX_LAUNCH_PROFILES, removeLaunchProfile, renameLaunchProfile, selectLaunchProfile, withLaunchOptions } from "../../../lib/launchProfiles";
import { Select } from "../../ui/Select";
import { PrefixManager } from "./PrefixManager";
import { Switch } from "../../ui/Checkbox";
import type { EditorContext } from "./types";
import { useTranslation } from "../../../lib/useTranslation";

const empty: LaunchOptions = { env: [], args: [] };

/** Environment, arguments, working directory, runtime and wrappers. The "Final command" is built by the launcher itself. */
export function LaunchOptionsSection({ ctx }: { ctx: EditorContext }) {
  const t = useTranslation();
  const { draft, patch, capabilities } = ctx;
  const options = effectiveLaunchOptions(draft) ?? empty;
  const profile = activeLaunchProfile(draft);
  const linux = capabilities?.platform !== "macos";
  const set = (changes: Partial<LaunchOptions>) => patch(withLaunchOptions(draft, updateLaunchOptions(effectiveLaunchOptions(draft), changes)));
  const [newName, setNewName] = useState("");
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [argsText, setArgsText] = useState(() => formatArgs(options.args));
  const [gamescopeText, setGamescopeText] = useState(() => formatArgs(options.gamescope?.args ?? []));
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (linux) void listLaunchRuntimes().then(setRuntimes).catch(() => {}); }, [linux]);

  // The launcher builds the preview (debounced; a stale answer is dropped).
  const tofu = draft.tofus[0];
  const target = launchTargetFor(draft, tofu) ?? "";
  const signature = JSON.stringify([target, draft.id, effectiveLaunchOptions(draft), tofu?.id, tofu?.launch]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      previewLaunchCommand(draft, tofu).then((result) => { if (!cancelled) { setPreview(result); setPreviewFailed(false); } }).catch(() => { if (!cancelled) setPreviewFailed(true); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const applies = preview?.applies ?? "full";
  const mayEdit = applies !== "none";
  const full = applies === "full";
  const compat = useMemo(() => runtimes.filter((runtime) => runtime.kind === "compat"), [runtimes]);
  const have = (id: string) => runtimes.some((runtime) => runtime.id === id);
  const runtimeValue = options.runtime?.kind === "wine" ? "wine" : options.runtime?.kind === "proton" ? options.runtime.id ?? "" : "";
  const chooseRuntime = (value: string) => set({ runtime: !value ? undefined : value === "wine" ? { kind: "wine", id: "wine" } : { kind: "proton", id: value } });
  const duplicates = duplicateEnvNames(options.env);
  const wrapperHint = (id: string, name: string) => have(id) || !runtimes.length ? undefined : t("{name} is not installed.").replace("{name}", name);

  const copySteam = () => { if (preview?.steamOptions) void navigator.clipboard?.writeText(preview.steamOptions).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  const chooseDir = async () => { const picked = await open({ directory: true, multiple: false, title: t("Choose working directory") }); if (typeof picked === "string") set({ workingDir: picked }); };

  return <section className="launch-options" aria-label="Launch options">
    <div className="launch-options-heading"><h3>Launch options</h3><p>Applied each time Mochi starts this game. Tofu launch settings override them.</p></div>
    <div className="editor-field launch-profiles"><span className="editor-field-label">Launch profile</span>
      <div className="launch-profile-row">
        <select aria-label="Launch profile in use" value={profile?.id ?? ""} onChange={(event) => patch({ activeLaunchProfile: selectLaunchProfile(draft, event.target.value || undefined) })}>
          <option value="">Default options</option>
          {(draft.launchProfiles ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {profile && <input aria-label="Rename profile" defaultValue={profile.name} key={profile.id} maxLength={40} onBlur={(event) => { if (event.target.value.trim()) patch({ launchProfiles: renameLaunchProfile(draft, profile.id, event.target.value) }); else event.target.value = profile.name; }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />}
        {profile && <button type="button" className="icon-button" aria-label={t("Delete profile {name}").replace("{name}", profile.name)} onClick={() => patch(removeLaunchProfile(draft, profile.id))}><Trash2 size={14} /></button>}
      </div>
      <div className="launch-profile-row">
        <input aria-label={t("New profile name")} value={newName} maxLength={40} placeholder={t("New profile, copied from the current options")} disabled={(draft.launchProfiles?.length ?? 0) >= MAX_LAUNCH_PROFILES} onChange={(event) => setNewName(event.target.value)} />
        <button type="button" className="secondary-button" disabled={!newName.trim() || (draft.launchProfiles?.length ?? 0) >= MAX_LAUNCH_PROFILES} onClick={() => { patch(addLaunchProfile(draft, newName)); setNewName(""); }}><Plus size={13} /> Add profile</button>
      </div>
      <small className="metadata-note">{profile ? t("Editing “{name}”: its options replace the default ones when the game starts.").replace("{name}", profile.name) : t("Profiles hold alternative runtime, variables and arguments, switchable from the game page.")}</small>
    </div>
    {preview?.note && <p className="launch-hint launch-options-note" role="status">{preview.note}</p>}

    <div className="editor-field"><span className="editor-field-label">Environment variables</span>
      <div className="launch-env" role="group" aria-label="Environment variables">
        {options.env.map(([key, value], index) => {
          const problem = envNameError(key) ?? (duplicates.has(key.trim()) ? t("Set more than once. The last one wins.") : null);
          return <div className="launch-env-row" key={index}>
            <input value={key} aria-label={t("Variable {index} name").replace("{index}", String(index + 1))} placeholder="NAME" spellCheck={false} autoComplete="off" aria-invalid={!!envNameError(key)} disabled={!mayEdit} onChange={(event) => set({ env: setEnvRow(options.env, index, [event.target.value, value]) })} />
            <input value={value} aria-label={t("Variable {index} value").replace("{index}", String(index + 1))} placeholder="value" spellCheck={false} autoComplete="off" disabled={!mayEdit} onChange={(event) => set({ env: setEnvRow(options.env, index, [key, event.target.value]) })} />
            <button type="button" className="icon-button" aria-label={t("Remove variable {index}").replace("{index}", String(index + 1))} disabled={!mayEdit} onClick={() => set({ env: removeEnvRow(options.env, index) })}><Trash2 size={14} /></button>
            {problem && <small className="launch-field-error" role="alert">{t(problem)}</small>}
          </div>;
        })}
        <button type="button" className="secondary-button launch-env-add" disabled={!mayEdit || options.env.length >= 64} onClick={() => set({ env: addEnvRow(options.env) })}><Plus size={14} /> Add variable</button>
      </div>
    </div>

    <div className="editor-field"><span className="editor-field-label">Arguments</span>
      <input aria-label="Arguments" value={argsText} placeholder={`-windowed --name "My Player"`} spellCheck={false} autoComplete="off" disabled={!mayEdit} onChange={(event) => { setArgsText(event.target.value); set({ args: parseArgs(event.target.value) }); }} />
      <small className="launch-hint">Quotes group words and a backslash escapes the next character. Nothing is run through a shell.</small>
    </div>

    <div className="editor-field"><span className="editor-field-label">Run before launch</span>
      <input aria-label="Command to run before launch" value={options.hooks?.pre ?? ""} placeholder="obs --startreplaybuffer" spellCheck={false} autoComplete="off" disabled={!mayEdit} onChange={(event) => set({ hooks: { ...options.hooks, pre: event.target.value } })} />
      <span className="editor-field-label">Run after the game closes</span>
      <input aria-label="Command to run after the game closes" value={options.hooks?.post ?? ""} placeholder="/home/me/scripts/sync-saves.sh" spellCheck={false} autoComplete="off" disabled={!mayEdit} onChange={(event) => set({ hooks: { ...options.hooks, post: event.target.value } })} />
      <small className="launch-hint">A program and its arguments, run directly (use <code>sh -c "..."</code> if you need a shell). The before-command is waited for up to 30 seconds; if either fails you get a notice and the game still launches. Works the same on macOS.</small>
    </div>

    {full && <div className="editor-field"><span className="editor-field-label" id="launch-cwd-label">Working directory</span>
      <div className="flatpak-input-row">
        <input aria-labelledby="launch-cwd-label" value={options.workingDir ?? ""} placeholder="Default" onChange={(event) => set({ workingDir: event.target.value })} />
        <button type="button" className="secondary-button" onClick={() => void chooseDir()}><FolderOpen size={14} /> Choose…</button>
      </div>
    </div>}

    {linux && full && <>
      {compat.length > 0 && <div className="editor-field"><span className="editor-field-label">Windows runtime</span>
        <Select label="Windows runtime" value={runtimeValue} onChange={chooseRuntime} searchable={false} options={[{ value: "", label: "Automatic (native, or Wine if available)" }, ...compat.map((runtime) => ({ value: runtime.id, label: runtime.name, description: runtime.id === "wine" ? "System Wine" : "Proton, with a private prefix for this game" }))]} />
        <small className="launch-hint">{t("Used for Windows programs (.exe). Native games ignore it.")}</small>
      </div>}
      {compat.length > 0 && /\.(exe|bat|msi|lnk)$/i.test(target) && <PrefixManager gameId={draft.id} tofuId={tofu?.id} gameName={draft.name} runtime={runtimeIdOf(options.runtime)} />}
      <div className="launch-toggles" role="group" aria-label="Wrappers">
        <Switch label="GameMode" description={wrapperHint("gamemoderun", "GameMode") ?? t("Runs the game through gamemoderun.")} checked={!!options.gamemode} onChange={(on) => set({ gamemode: on })} />
        <Switch label="MangoHud" description={wrapperHint("mangohud", "MangoHud") ?? t("Shows the performance overlay.")} checked={!!options.mangohud} onChange={(on) => set({ mangohud: on })} />
        <Switch label="gamescope" description={t("Runs the game inside a gamescope session.")} checked={!!options.gamescope?.enabled} onChange={(on) => set({ gamescope: { enabled: on, args: options.gamescope?.args ?? [] } })} />
      </div>
      {options.gamescope?.enabled && <div className="editor-field"><span className="editor-field-label">gamescope arguments</span>
        <input aria-label="gamescope arguments" value={gamescopeText} placeholder="-W 1920 -H 1080 -f" spellCheck={false} autoComplete="off" onChange={(event) => { setGamescopeText(event.target.value); set({ gamescope: { enabled: true, args: parseArgs(event.target.value) } }); }} />
      </div>}
    </>}

    {linux && applies === "steam" && <div className="launch-toggles" role="group" aria-label="Wrappers">
      <Switch label="GameMode" checked={!!options.gamemode} onChange={(on) => set({ gamemode: on })} />
      <Switch label="MangoHud" checked={!!options.mangohud} onChange={(on) => set({ mangohud: on })} />
      <Switch label="gamescope" checked={!!options.gamescope?.enabled} onChange={(on) => set({ gamescope: { enabled: on, args: options.gamescope?.args ?? [] } })} />
      {options.gamescope?.enabled && <input value={gamescopeText} aria-label="gamescope arguments" placeholder="-W 1920 -H 1080 -f" spellCheck={false} onChange={(event) => { setGamescopeText(event.target.value); set({ gamescope: { enabled: true, args: parseArgs(event.target.value) } }); }} />}
    </div>}

    {preview?.errors.filter((error) => !error.includes("is not a valid variable name")).map((error) => <p className="auth-error editor-warning launch-error" role="alert" key={error}>{t(error)}</p>)}

    {applies === "steam" && preview?.steamOptions && <div className="editor-field"><span className="editor-field-label" id="launch-steam-label">Steam launch options</span>
      <div className="launch-command-row">
        <code className="launch-command" aria-labelledby="launch-steam-label" tabIndex={0}>{preview.steamOptions}</code>
        <button type="button" className="secondary-button" onClick={copySteam}><Copy size={14} /> {copied ? t("Copied") : t("Copy")}</button>
      </div>
      <small className="launch-hint">Paste this into the game's Properties, General, Launch options in Steam. Runtimes and the working directory are managed by Steam.</small>
    </div>}
    {(applies === "full" || applies === "flatpak") && <div className="editor-field"><span className="editor-field-label" id="launch-final-label">Final command</span>
      <code className="launch-command" role="textbox" aria-readonly="true" aria-labelledby="launch-final-label" tabIndex={0}>{preview?.command ?? (previewFailed ? t("Preview unavailable.") : preview?.errors.length ? t("Fix the problems above to see the command.") : "…")}</code>
    </div>}
  </section>;
}
