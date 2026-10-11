import { useEffect, useState } from "react";
import { clampAutoExtendBelow, MAX_AUTO_EXTEND_BELOW } from "../../lib/mods/autoExtend";
import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";

/** "Add other mod sites when a game has fewer than [N] mods". Typing is free-form; the stored value is always a clamped integer 0..100. */
function AutoExtendRow({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="setting-row"><span><strong>Add other mod sites for games with few mods</strong><small>Discover adds mods from the game's other enabled sites (for example Nexus Mods) when its first site lists fewer than this many. 0 never adds sites; the most is {MAX_AUTO_EXTEND_BELOW}.</small></span>
    <input className="compact-input" type="number" inputMode="numeric" min={0} max={MAX_AUTO_EXTEND_BELOW} step={1} value={draft} aria-label="Add other mod sites when a game has fewer than this many mods"
      onChange={(event) => { setDraft(event.target.value); if (event.target.value.trim() !== "") onChange(clampAutoExtendBelow(event.target.value)); }}
      onBlur={() => setDraft(String(value))} style={{ width: 84 }} /></label>;
}

/** Which mod sites Mochi lists and downloads from. A switched-off site is never contacted. */
export function ModSourcesSection() {
  const t = useTranslation();
  const { behavior, setBehavior, credentials } = useApp();
  const sources = behavior.modSources;
  const set = (key: keyof typeof sources, value: boolean) => setBehavior((current) => ({ ...current, modSources: { ...current.modSources, [key]: value } }));
  const none = !sources.modrinth && !sources.curseforge && !sources.nexus;
  return <SettingsGroup title={t("Mod sources")} subtitle={t("Where Discover, game pages and Tofus find mods")} id="settings-modsources">
    <ToggleRow title="Modrinth" description={t("Minecraft mods, modpacks, resource packs and shaders.")} checked={sources.modrinth} onChange={(value) => set("modrinth", value)} />
    <ToggleRow title="CurseForge" description={t("Most games, and Minecraft. No account or key needed. When a game is on CurseForge, Nexus Mods is not used for it.")} checked={sources.curseforge} onChange={(value) => set("curseforge", value)} />
    <ToggleRow title="Nexus Mods" description={credentials.status.nexus ? "Used for games that are not on CurseForge." : "Used for games that are not on CurseForge. Needs your Nexus API key (Mod & metadata providers)."} checked={sources.nexus} onChange={(value) => set("nexus", value)} />
    <AutoExtendRow value={behavior.modAutoExtendBelow} onChange={(value) => setBehavior((current) => ({ ...current, modAutoExtendBelow: value }))} />
    <ToggleRow title={t("Automatically update mods")} description="Off by default. Before a game starts, Mochi installs updates of the mods it installed (SHA-1 verified, with a rollback copy), never while it runs. Also in the Updates tab." checked={behavior.autoUpdateMods} onChange={(value) => setBehavior((current) => ({ ...current, autoUpdateMods: value }))} />
    {none && <small className="metadata-note settings-note" role="status">All mod sources are off, so Discover and the mod managers have nothing to show.</small>}
    <small className="metadata-note settings-note">With Modrinth off, every Minecraft content type comes from CurseForge. With CurseForge off, Minecraft uses Modrinth only.</small>
  </SettingsGroup>;
}
