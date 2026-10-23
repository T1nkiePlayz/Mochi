import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "../../lib/useTranslation";
import { getPlatformCapabilities } from "../../lib/platform";
import { confirmAction } from "../../lib/confirm";
import {
  formatRuntimeSize, installPercent, installRuntime, listInstalledRuntimes, listRuntimeReleases, removeRuntime, runtimeInstallProgressEvent,
  type InstalledRuntimes, type RuntimeInstallProgress, type RuntimeKind, type RuntimeRelease,
} from "../../lib/runtimeInstaller";
import { SettingsGroup } from "./Section";

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "");

/** Proton-GE or Wine-GE: what is installed, the latest releases, and install / remove. Linux only. */
function RuntimeKindPanel({ kind, title, progress }: { kind: RuntimeKind; title: string; progress: RuntimeInstallProgress | null }) {
  const t = useTranslation();
  const [installed, setInstalled] = useState<InstalledRuntimes>({ root: null, runtimes: [] });
  const [releases, setReleases] = useState<RuntimeRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = progress !== null && progress.kind === kind && progress.phase !== "done" && progress.phase !== "failed";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setInstalled(await listInstalledRuntimes(kind)); } catch (e) { setError(errorText(e)); }
    try { setReleases(await listRuntimeReleases(kind)); } catch (e) { setError(errorText(e)); }
    setLoading(false);
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (progress?.kind === kind && progress.phase === "done") void refresh(); }, [progress, kind, refresh]);

  const install = (tag: string) => { setError(""); installRuntime(kind, tag).catch((e) => setError(errorText(e))); };
  const remove = (name: string) => void confirmAction({
    title: t("Remove {name}?").replace("{name}", name), danger: true, confirmLabel: t("Remove runtime"),
    message: t("The runtime folder is deleted. Games that use it need another runtime."), items: [name],
  }).then(async (ok) => {
    if (!ok) return;
    try { await removeRuntime(kind, name); await refresh(); } catch (e) { setError(errorText(e)); }
  });

  const status = (tag: string) => {
    if (!progress || progress.kind !== kind || progress.tag !== tag || !busy) return null;
    const percent = installPercent(progress);
    if (progress.phase === "downloading") return percent === null ? t("Downloading… {percent}%").replace("{percent}", "0") : t("Downloading… {percent}%").replace("{percent}", String(percent));
    if (progress.phase === "preparing") return t("Preparing…");
    return progress.phase === "verifying" ? t("Verifying download…") : t("Unpacking…");
  };

  return <div className="runtime-kind-panel">
    <div className="settings-group-heading"><strong>{title}</strong>{installed.root && <span>{t("Installs into {path}").replace("{path}", installed.root)}</span>}</div>
    {installed.runtimes.length
      ? installed.runtimes.map((runtime) => <div className="setting-row" key={runtime.name}><span><strong>{runtime.name}</strong><small>{t("Installed")}</small></span><button type="button" className="secondary-button danger-outline" disabled={busy} onClick={() => remove(runtime.name)}><Trash2 size={13} /> {t("Remove")}</button></div>)
      : <small className="metadata-note">{t("Nothing installed yet.")}</small>}
    <div className="settings-group-heading"><strong>{t("Latest releases")}</strong><button type="button" className="secondary-button" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw size={13} className={loading ? "spin" : undefined} /> {t("Refresh")}</button></div>
    {releases.map((release) => <div className="setting-row" key={release.tag}>
      <span><strong>{release.name}</strong><small>{status(release.tag) ?? (release.installed ? t("Installed") : formatRuntimeSize(release.size))}</small></span>
      <button type="button" className="secondary-button" disabled={busy || release.installed} onClick={() => install(release.tag)}><Download size={13} /> {t("Install")}</button>
    </div>)}
    {error && <small className="metadata-note" role="alert">{error}</small>}
  </div>;
}

export function RuntimesSection() {
  const t = useTranslation();
  const [supported, setSupported] = useState(false);
  const [progress, setProgress] = useState<RuntimeInstallProgress | null>(null);

  useEffect(() => { void getPlatformCapabilities().then((caps) => setSupported(caps.supportsRuntimeInstall)).catch(() => setSupported(false)); }, []);
  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<RuntimeInstallProgress>(runtimeInstallProgressEvent, (event) => setProgress(event.payload))
      .then((off) => { if (disposed) off(); else unlisten = off; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, [supported]);

  if (!supported) return null;
  return <SettingsGroup title={t("Compatibility tools")} subtitle={t("Install Proton-GE or Wine-GE to run Windows games")} id="settings-runtimes">
    <RuntimeKindPanel kind="proton" title={t("Proton-GE")} progress={progress} />
    <RuntimeKindPanel kind="wine" title={t("Wine-GE")} progress={progress} />
  </SettingsGroup>;
}
