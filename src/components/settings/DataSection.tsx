import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { MochiIcon } from "../MochiIcon";
import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";

export function DataSection() {
  const { behavior, setBehavior, account, credentials, lib, metadata, cloud, themeEngine, chooseConfigLocation } = useApp();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const igdb = credentials.status.igdb;
  return <SettingsGroup title="Data & privacy" subtitle="Local-first storage" id="settings-data">
    <div className="setting-row"><span><strong>Refresh IGDB game metadata</strong><small>Clear cached IGDB details and artwork, then fetch current information for your library.</small></span><button type="button" className="secondary-button" disabled={!igdb || metadata.refreshBusy || !lib.library.length} onClick={() => void metadata.refreshAll(lib.library)}>{metadata.refreshBusy ? "Refreshing…" : "Refresh all metadata"}</button></div>
    {!igdb && <small className="metadata-note settings-note">Sign in and save IGDB credentials to refresh game information.</small>}
    <div className="setting-row"><span><strong>Cloud data</strong><small>{cloud.cloudDataAccessAllowed ? "Delete your cloud Pikos and Tofus. Your local library, account, and saved provider credentials stay unchanged." : "Mochi Cloud data controls are not enabled for this account."}</small></span><button type="button" className="secondary-button danger-outline" disabled={!account.user || !cloud.cloudDataAccessAllowed || cloud.cloudDataBusy} onClick={() => void cloud.clearCloudData()}>{cloud.cloudDataBusy ? "Clearing…" : cloud.cloudDataAccessAllowed ? "Clear cloud data" : "Unavailable"}</button></div>
    {cloud.cloudDataMessage && <p className="metadata-note settings-note" role="status">{cloud.cloudDataMessage}</p>}
    <div className="setting-row setting-location-row"><span><strong>Library location</strong><small>Your Mochi configuration, themes and launcher data are stored here.</small></span><span className="setting-location-value"><code>{themeEngine.configInfo?.configPath || "Default Mochi location"}</code><button type="button" className="secondary-button" onClick={() => void chooseConfigLocation()}>Change</button></span></div>
    <button className="setting-row setting-button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)}><span><strong>Advanced settings</strong><small>Diagnostics and launcher controls.</small></span><MochiIcon name="chevron" fallback={ChevronDown} className={showAdvanced ? "rotate" : ""} size={16} /></button>
    {showAdvanced && <div className="advanced-settings">
      <ToggleRow title="Confirm before launching" description="Ask before starting a game." checked={behavior.confirmLaunch} onChange={(confirmLaunch) => setBehavior({ ...behavior, confirmLaunch })} />
      <ToggleRow title="Detailed launch errors" description="Show extra information when a game fails to launch." checked={behavior.detailedErrors} onChange={(detailedErrors) => setBehavior({ ...behavior, detailedErrors })} />
    </div>}
  </SettingsGroup>;
}
