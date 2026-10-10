import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../state/AppContext";
import { useExperimental } from "../../state/useExperimental";
import { openPath } from "../../lib/platform";
import { SettingsGroup, ToggleRow } from "./Section";

/** Experimental: only shown while the "Plugins" experimental feature is on. */
export function PluginsSection() {
  const { behavior, setBehavior, plugins } = useApp();
  const on = useExperimental("plugins");
  if (!on) return null;
  const toggle = (id: string, enable: boolean) => setBehavior((current) => ({ ...current, enabledPlugins: enable ? [...new Set([...current.enabledPlugins, id])] : current.enabledPlugins.filter((item) => item !== id) }));
  return <SettingsGroup title="Plugins" subtitle="Experimental. Plugins run in a restricted sandbox, but only enable plugins you trust" id="settings-plugins">
    {plugins.plugins.length === 0 && <p className="muted">No plugins found. Put each plugin in its own folder with a plugin.json and main.js, then refresh. See docs/plugins.md.</p>}
    {plugins.plugins.map((plugin) => plugin.manifest && !plugin.error
      ? <ToggleRow key={plugin.dir} title={`${plugin.manifest.name} ${plugin.manifest.version}`} description={`${plugin.manifest.description || "No description."} Permissions: ${plugin.manifest.permissions.join(", ") || "none"}.`} checked={behavior.enabledPlugins.includes(plugin.manifest.id)} onChange={(enable) => toggle(plugin.manifest!.id, enable)} />
      : <div className="setting-row" key={plugin.dir}><span><strong>{plugin.dir}</strong><small>{plugin.error}</small></span></div>)}
    <div className="setting-row">
      <button type="button" className="secondary-button" onClick={() => void plugins.refresh()}>Refresh</button>
      <button type="button" className="secondary-button" onClick={() => void invoke<string>("plugins_folder").then(openPath).catch(() => {})}>Open plugins folder</button>
    </div>
  </SettingsGroup>;
}
