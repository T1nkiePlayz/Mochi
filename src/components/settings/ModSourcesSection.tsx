import { useApp } from "../../state/AppContext";
import { SettingsGroup, ToggleRow } from "./Section";

/** Which mod sites Mochi lists and downloads from. A switched-off site is never contacted. */
export function ModSourcesSection() {
  const { behavior, setBehavior, credentials } = useApp();
  const sources = behavior.modSources;
  const set = (key: keyof typeof sources, value: boolean) => setBehavior((current) => ({ ...current, modSources: { ...current.modSources, [key]: value } }));
  const none = !sources.modrinth && !sources.curseforge && !sources.nexus;
  return <SettingsGroup title="Mod sources" subtitle="Where Discover, game pages and Tofus find mods" id="settings-modsources">
    <ToggleRow title="Modrinth" description="Minecraft mods, modpacks, resource packs and shaders." checked={sources.modrinth} onChange={(value) => set("modrinth", value)} />
    <ToggleRow title="CurseForge" description="Most games, and Minecraft. No account or key needed. When a game is on CurseForge, Nexus Mods is not used for it." checked={sources.curseforge} onChange={(value) => set("curseforge", value)} />
    <ToggleRow title="Nexus Mods" description={credentials.status.nexus ? "Used for games that are not on CurseForge." : "Used for games that are not on CurseForge. Needs your Nexus API key (Mod & metadata providers)."} checked={sources.nexus} onChange={(value) => set("nexus", value)} />
    {none && <small className="metadata-note settings-note" role="status">All mod sources are off, so Discover and the mod managers have nothing to show.</small>}
    <small className="metadata-note settings-note">With Modrinth off, every Minecraft content type comes from CurseForge. With CurseForge off, Minecraft uses Modrinth only.</small>
  </SettingsGroup>;
}
