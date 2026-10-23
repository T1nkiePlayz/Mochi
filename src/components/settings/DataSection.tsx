import { useMemo, useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
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
import { LibraryBackup } from "./LibraryBackup";
import { steamPlaytimeTargets } from "../../lib/steamPlaytime";
import { PlaytimeImport } from "./PlaytimeImport";
import { useSteamPlaytimeImport } from "../../state/useSteamPlaytimeImport";

export function DataSection() {
  const t = useTranslation();
  const { behavior, setBehavior, account, credentials, lib, metadata, cloud, themeEngine, chooseConfigLocation, refreshPlaytime } = useApp();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const user = account.user;
  const [busy, setBusy] = useState<DataSourceId | "all" | null>(null);
  const [note, setNote] = useState("");
  const playtimeTargets = useMemo(() => steamPlaytimeTargets(lib.library), [lib.library]);
  const { state: steamPlaytime, run: runSteamPlaytime } = useSteamPlaytimeImport();
  const saved = { igdb: credentials.status.igdb, steamgriddb: credentials.status.steamgriddb };
  // Each source says precisely what it needs, so a disabled button is never a mystery.
  const needs = (id: ProviderId): { ready: boolean; text: string } => {
    if (id === "steam") return { ready: true, text: t("Works without an account or a key, for games that launch through Steam.") };
    if (!user) return { ready: false, text: `${providerLabels[id]} needs a free key that is saved on your Mochi account, so sign in first. Other sources keep working without it.` };
    if (!saved[id]) return { ready: false, text: t("Save your {provider} key under Mod & metadata providers to use it. Other sources keep working without it.").replace("{provider}", providerLabels[id]) };
    return { ready: true, text: t("Ready.") };
  };
  const copyDiagnostics = async () => {
    try {
      const caps = await getPlatformCapabilities().catch(() => ({ platform: "unknown", displayName: "Unknown", isSteamDeck: false, isGamescope: false, launchMethods: [] as string[] }));
      const bySource: Record<string, number> = {};
      for (const piko of lib.library) { const kind = piko.kind ?? "game"; bySource[kind] = (bySource[kind] ?? 0) + 1; }
      const report = buildDiagnostics({ version: await getVersion().catch(() => "unknown"), platform: caps, userAgent: navigator.userAgent, online: navigator.onLine, gameCount: lib.library.length, gamesBySource: bySource, experimental: behavior.experimental, signedIn: Boolean(user) });
      await navigator.clipboard.writeText(report);
      setNote(t("Debug info copied. It contains no passwords, keys or email addresses, and your home folder name is hidden."));
    } catch { setNote(t("Could not copy debug info.")); }
  };
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  // Names exactly what goes: the source's saved lookups plus how many covers on this device came from it.
  const ask = (id: DataSourceId | "all") => {
    if (id === "all") {
      const covers = dataSources.filter((source) => source.id !== "custom-artwork").reduce((sum, source) => sum + gamesWithArtworkFrom(lib.library, source.id).length, 0);
      return confirmAction({ title: t("Clear all cached data?"), danger: true, confirmLabel: t("Clear all"),
        message: t("Games stay in your library and show generated covers until you refresh. Artwork you chose yourself is kept."),
        items: [...dataSources.filter((source) => source.id !== "custom-artwork").map((source) => t("Saved {source} data").replace("{source}", t(source.label))), plural(covers, "downloaded cover")] });
    }
    const source = dataSources.find((item) => item.id === id)!;
    const covers = gamesWithArtworkFrom(lib.library, id).length;
    if (id === "custom-artwork") return confirmAction({ title: t("Delete your own artwork?"), danger: true, confirmLabel: t("Delete artwork"), message: t("Every cover you picked yourself is deleted from this device. This cannot be undone and they are not fetched again."), items: [plural(covers, "custom cover")] });
    return confirmAction({ title: t("Clear {source} data?").replace("{source}", t(source.label)), danger: true, confirmLabel: t("Clear"), message: t("{detail} Games stay in your library; refresh to fetch it again.").replace("{detail}", t(source.detail)),
      items: [t("Saved {source} data on this device").replace("{source}", t(source.label)), ...(covers ? [plural(covers, `cover from ${source.label}`)] : [])] });
  };
  const run = async (id: DataSourceId | "all") => {
    if (!await ask(id)) return;
    setBusy(id); setNote("");
    try {
      const removed = id === "all" ? await clearAllDataSources(lib.library, lib.setLibrary, user?.id) : await clearDataSource(id, lib.library, lib.setLibrary, user?.id);
      setNote(id === "all" ? t("Cleared saved data for every source. Your own artwork was kept.") : t("Cleared {source} data{covers}.").replace("{source}", t(dataSources.find((source) => source.id === id)?.label ?? "data source")).replace("{covers}", removed ? ` ${t("and {count} covers").replace("{count}", String(removed))}` : ""));
    } catch (error) { setNote(error instanceof Error ? error.message : t("Could not clear that data.")); }
    finally { setBusy(null); }
  };
  const importPlaytime = async () => {
    const result = await runSteamPlaytime(playtimeTargets);
    // The stats view reloads as soon as the playtime totals change.
    if (result) void refreshPlaytime();
  };
  return <SettingsGroup title={t("Data & privacy")} subtitle={t("Local-first storage")} id="settings-data">
    <div className="setting-row"><span><strong>{t("Refresh all metadata")}</strong><small>{t("Refresh every available provider for games in your library. Manually locked fields and artwork you chose yourself are preserved.")}</small></span><button type="button" className="secondary-button" disabled={metadata.refreshBusy || lib.library.length === 0} onClick={() => void metadata.refreshAll(lib.library)}>{metadata.refreshingAll ? t("Refreshing all…") : t("Refresh all metadata")}</button></div>
    <div className="data-source-list" role="list" aria-label={t("Metadata sources")}>
      {dataSources.map((source) => {
        const provider = source.id === "igdb" || source.id === "steamgriddb" || source.id === "steam" ? source.id : null;
        const need = provider ? needs(provider) : null;
        const count = provider ? metadata.refreshableCount(lib.library, provider) : 0;
        const covers = gamesWithArtworkFrom(lib.library, source.id).length;
        return <div className="data-source-row" role="listitem" key={source.id}>
          <span><strong>{t(source.label)}</strong><small>{t(source.detail)}</small></span>
          <span className="data-source-actions">
            {provider && <button type="button" className="secondary-button" disabled={!need?.ready || count === 0 || metadata.refreshBusy} title={!need?.ready ? t(need?.text ?? "") : count === 0 ? t("No game in your library can use this source.") : undefined} onClick={() => void metadata.refreshProvider(lib.library, provider)}>{metadata.refreshingProvider === provider ? t("Refreshing…") : t("Refresh") + (count ? ` (${count})` : "")}</button>}
            <button type="button" className="secondary-button danger-outline" disabled={busy !== null || (source.id === "custom-artwork" && covers === 0)} onClick={() => void run(source.id)}>{busy === source.id ? t("Clearing…") : t("Clear {source} data").replace("{source}", t(source.label))}</button>
          </span>
          {need && <p className={`data-source-state${need.ready ? " ready" : ""}`}>{need.ready && count === 0 ? t("No game in your library can use this source yet.") : t(need.text)}</p>}
        </div>;
      })}
    </div>
    <div className="setting-row"><span><strong>{t("Find missing covers")}</strong><small>{(() => { const missing = metadata.missingCovers(lib.library).length; return missing ? t("{count} games show a generated cover. Mochi looks each one up once (Steam games need no keys).").replace("{count}", String(missing)) : t("Every game that can have a cover already has one."); })()}</small></span><button type="button" className="secondary-button" disabled={metadata.refreshBusy || metadata.missingCovers(lib.library).length === 0} onClick={() => void metadata.findMissingCovers(lib.library)}>{metadata.refreshBusy ? t("Working…") : t("Find covers")}</button></div>
    <div className="setting-row"><span><strong>{t("Import Steam playtime")}</strong><small>{t("Adds the playtime Steam saved for your games to Mochi's stats, as one earlier session per game. Importing twice adds nothing.")}</small></span><button type="button" className="secondary-button" disabled={playtimeTargets.length === 0 || steamPlaytime.status === "importing"} onClick={() => void importPlaytime()}>{steamPlaytime.status === "importing" ? t("Importing…") : t("Import")}</button></div>
    {steamPlaytime.status === "done" && <p className="metadata-note settings-note" role="status">{t("Steam playtime: {imported} games updated, {unchanged} already matched, {unmapped} not in your library.").replace("{imported}", String(steamPlaytime.result.imported)).replace("{unchanged}", String(steamPlaytime.result.unchanged)).replace("{unmapped}", String(steamPlaytime.result.unmapped))}</p>}
    {steamPlaytime.status === "error" && <p className="metadata-note settings-note" role="alert">{steamPlaytime.message}</p>}
    <PlaytimeImport library={lib.library} onImported={() => void refreshPlaytime()} />
    <div className="data-source-footer">
      <small className="metadata-note">{t("Clearing removes saved lookups and downloaded covers from this device only. Games stay in your library and Mochi shows generated covers until you refresh.")}</small>
      <button type="button" className="secondary-button danger-outline" disabled={busy !== null} onClick={() => void run("all")}>{busy === "all" ? t("Clearing…") : t("Clear all cached data")}</button>
    </div>
    {note && <p className="metadata-note settings-note" role="status">{note}</p>}
    <div className="setting-row"><span><strong>{t("Cloud data")}</strong><small>{cloud.cloudDataAccessAllowed ? t("Delete your cloud Pikos and Tofus. Your local library, account, and saved provider credentials stay unchanged.") : t("Mochi Cloud data controls are not enabled for this account.")}</small></span><button type="button" className="secondary-button danger-outline" disabled={!account.user || !cloud.cloudDataAccessAllowed || cloud.cloudDataBusy} onClick={() => void cloud.clearCloudData()}>{cloud.cloudDataBusy ? t("Clearing…") : cloud.cloudDataAccessAllowed ? t("Clear cloud data") : t("Unavailable")}</button></div>
    {cloud.cloudDataMessage && <p className="metadata-note settings-note" role="status">{cloud.cloudDataMessage}</p>}
    <div className="setting-row setting-location-row"><span><strong>{t("Library location")}</strong><small>{t("Your Mochi configuration, themes and launcher data are stored here.")}</small></span><span className="setting-location-value"><code>{themeEngine.configInfo?.configPath || t("Default Mochi location")}</code><button type="button" className="secondary-button" onClick={() => void chooseConfigLocation()}>{t("Change")}</button></span></div>
    <SettingsTransfer />
    <LibraryBackup />
    <button className="setting-row setting-button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)}><span><strong>{t("Advanced settings")}</strong><small>{t("Diagnostics and launcher controls.")}</small></span><MochiIcon name="chevron" fallback={ChevronDown} className={showAdvanced ? "rotate" : ""} size={16} /></button>
    {showAdvanced && <div className="advanced-settings">
      <ToggleRow title={t("Confirm before launching")} description={t("Ask before starting a game.")} checked={behavior.confirmLaunch} onChange={(confirmLaunch) => setBehavior((current) => ({ ...current, confirmLaunch }))} />
      <ToggleRow title={t("Detailed launch errors")} description={t("Show extra information when a game fails to launch.")} checked={behavior.detailedErrors} onChange={(detailedErrors) => setBehavior((current) => ({ ...current, detailedErrors }))} />
      <div className="setting-row"><span><strong>{t("Copy debug info")}</strong><small>{t("Version, system and library counts for a bug report. Secrets and your user name are removed.")}</small></span><button type="button" className="secondary-button" onClick={() => void copyDiagnostics()}>{t("Copy")}</button></div>
    </div>}
  </SettingsGroup>;
}
