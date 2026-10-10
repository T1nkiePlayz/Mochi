import { useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getPlatformCapabilities } from "../../lib/platform";
import { buildDiagnostics } from "../../lib/diagnostics";
import { ChevronDown } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { useApp } from "../../state/AppContext";
import { confirmAction } from "../../lib/confirm";
import { clearAllDataSources, clearDataSource, dataSources, gamesWithArtworkFrom, type DataSourceId } from "../../lib/providerData";
import { providerLabels } from "../../state/useCredentials";
import type { ProviderId } from "../../lib/metadata/types";
import { SettingsGroup, ToggleRow } from "./Section";
import { SettingsTransfer } from "./SettingsTransfer";

export function DataSection() {
  const { behavior, setBehavior, account, credentials, lib, metadata, cloud, themeEngine, chooseConfigLocation } = useApp();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const user = account.user;
  const [busy, setBusy] = useState<DataSourceId | "all" | null>(null);
  const [note, setNote] = useState("");
  const saved = { igdb: credentials.status.igdb, steamgriddb: credentials.status.steamgriddb };
  // Each source says precisely what it needs, so a disabled button is never a mystery.
  const needs = (id: ProviderId): { ready: boolean; text: string } => {
    if (id === "steam") return { ready: true, text: "Works without an account or a key, for games that launch through Steam." };
    if (!user) return { ready: false, text: `${providerLabels[id]} needs a free key that is saved on your Mochi account, so sign in first. Other sources keep working without it.` };
    if (!saved[id]) return { ready: false, text: `Save your ${providerLabels[id]} key under Mod & metadata providers to use it. Other sources keep working without it.` };
    return { ready: true, text: "Ready." };
  };
  const copyDiagnostics = async () => {
    try {
      const caps = await getPlatformCapabilities().catch(() => ({ platform: "unknown", displayName: "Unknown", isSteamDeck: false, isGamescope: false, launchMethods: [] as string[] }));
      const bySource: Record<string, number> = {};
      for (const piko of lib.library) { const kind = piko.kind ?? "game"; bySource[kind] = (bySource[kind] ?? 0) + 1; }
      const report = buildDiagnostics({ version: await getVersion().catch(() => "unknown"), platform: caps, userAgent: navigator.userAgent, online: navigator.onLine, gameCount: lib.library.length, gamesBySource: bySource, experimental: behavior.experimental, signedIn: Boolean(user) });
      await navigator.clipboard.writeText(report);
      setNote("Debug info copied. It contains no passwords, keys or email addresses, and your home folder name is hidden.");
    } catch { setNote("Could not copy debug info."); }
  };
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  // Names exactly what goes: the source's saved lookups plus how many covers on this device came from it.
  const ask = (id: DataSourceId | "all") => {
    if (id === "all") {
      const covers = dataSources.filter((source) => source.id !== "custom-artwork").reduce((sum, source) => sum + gamesWithArtworkFrom(lib.library, source.id).length, 0);
      return confirmAction({ title: "Clear all cached data?", danger: true, confirmLabel: "Clear all",
        message: "Games stay in your library and show generated covers until you refresh. Artwork you chose yourself is kept.",
        items: [...dataSources.filter((source) => source.id !== "custom-artwork").map((source) => `Saved ${source.label} data`), plural(covers, "downloaded cover")] });
    }
    const source = dataSources.find((item) => item.id === id)!;
    const covers = gamesWithArtworkFrom(lib.library, id).length;
    if (id === "custom-artwork") return confirmAction({ title: "Delete your own artwork?", danger: true, confirmLabel: "Delete artwork", message: "Every cover you picked yourself is deleted from this device. This cannot be undone and they are not fetched again.", items: [plural(covers, "custom cover")] });
    return confirmAction({ title: `Clear ${source.label} data?`, danger: true, confirmLabel: "Clear", message: `${source.detail} Games stay in your library; refresh to fetch it again.`,
      items: [`Saved ${source.label} data on this device`, ...(covers ? [plural(covers, `cover from ${source.label}`)] : [])] });
  };
  const run = async (id: DataSourceId | "all") => {
    if (!await ask(id)) return;
    setBusy(id); setNote("");
    try {
      const removed = id === "all" ? await clearAllDataSources(lib.library, lib.setLibrary, user?.id) : await clearDataSource(id, lib.library, lib.setLibrary, user?.id);
      setNote(id === "all" ? "Cleared saved data for every source. Your own artwork was kept." : `Cleared ${dataSources.find((source) => source.id === id)?.label} data${removed ? ` and ${removed} cover${removed === 1 ? "" : "s"}` : ""}.`);
    } catch (error) { setNote(error instanceof Error ? error.message : "Could not clear that data."); }
    finally { setBusy(null); }
  };
  return <SettingsGroup title="Data & privacy" subtitle="Local-first storage" id="settings-data">
    <div className="data-source-list" role="list" aria-label="Metadata sources">
      {dataSources.map((source) => {
        const provider = source.id === "igdb" || source.id === "steamgriddb" || source.id === "steam" ? source.id : null;
        const need = provider ? needs(provider) : null;
        const count = provider ? metadata.refreshableCount(lib.library, provider) : 0;
        const covers = gamesWithArtworkFrom(lib.library, source.id).length;
        return <div className="data-source-row" role="listitem" key={source.id}>
          <span><strong>{source.label}</strong><small>{source.detail}</small></span>
          <span className="data-source-actions">
            {provider && <button type="button" className="secondary-button" disabled={!need?.ready || count === 0 || metadata.refreshBusy} title={!need?.ready ? need?.text : count === 0 ? "No game in your library can use this source." : undefined} onClick={() => void metadata.refreshAll(lib.library, provider)}>{metadata.refreshBusy ? "Refreshing…" : `Refresh${count ? ` (${count})` : ""}`}</button>}
            <button type="button" className="secondary-button danger-outline" disabled={busy !== null || (source.id === "custom-artwork" && covers === 0)} onClick={() => void run(source.id)}>{busy === source.id ? "Clearing…" : `Clear ${source.label} data`}</button>
          </span>
          {need && <p className={`data-source-state${need.ready ? " ready" : ""}`}>{need.ready && count === 0 ? "No game in your library can use this source yet." : need.text}</p>}
        </div>;
      })}
    </div>
    <div className="data-source-footer">
      <small className="metadata-note">Clearing removes saved lookups and downloaded covers from this device only. Games stay in your library and Mochi shows generated covers until you refresh.</small>
      <button type="button" className="secondary-button danger-outline" disabled={busy !== null} onClick={() => void run("all")}>{busy === "all" ? "Clearing…" : "Clear all cached data"}</button>
    </div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
    <div className="setting-row"><span><strong>Cloud data</strong><small>{cloud.cloudDataAccessAllowed ? "Delete your cloud Pikos and Tofus. Your local library, account, and saved provider credentials stay unchanged." : "Mochi Cloud data controls are not enabled for this account."}</small></span><button type="button" className="secondary-button danger-outline" disabled={!account.user || !cloud.cloudDataAccessAllowed || cloud.cloudDataBusy} onClick={() => void cloud.clearCloudData()}>{cloud.cloudDataBusy ? "Clearing…" : cloud.cloudDataAccessAllowed ? "Clear cloud data" : "Unavailable"}</button></div>
    {cloud.cloudDataMessage && <p className="metadata-note settings-note" role="status">{cloud.cloudDataMessage}</p>}
    <div className="setting-row setting-location-row"><span><strong>Library location</strong><small>Your Mochi configuration, themes and launcher data are stored here.</small></span><span className="setting-location-value"><code>{themeEngine.configInfo?.configPath || "Default Mochi location"}</code><button type="button" className="secondary-button" onClick={() => void chooseConfigLocation()}>Change</button></span></div>
    <SettingsTransfer />
    <button className="setting-row setting-button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)}><span><strong>Advanced settings</strong><small>Diagnostics and launcher controls.</small></span><MochiIcon name="chevron" fallback={ChevronDown} className={showAdvanced ? "rotate" : ""} size={16} /></button>
    {showAdvanced && <div className="advanced-settings">
      <ToggleRow title="Confirm before launching" description="Ask before starting a game." checked={behavior.confirmLaunch} onChange={(confirmLaunch) => setBehavior((current) => ({ ...current, confirmLaunch }))} />
      <ToggleRow title="Detailed launch errors" description="Show extra information when a game fails to launch." checked={behavior.detailedErrors} onChange={(detailedErrors) => setBehavior((current) => ({ ...current, detailedErrors }))} />
      <div className="setting-row"><span><strong>Copy debug info</strong><small>Version, system and library counts for a bug report. Secrets and your user name are removed.</small></span><button type="button" className="secondary-button" onClick={() => void copyDiagnostics()}>Copy</button></div>
    </div>}
  </SettingsGroup>;
}
