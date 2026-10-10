import { ensureChecked } from "../state/modUpdates";
import { register } from "./commands";
import type { NavId } from "../state/AppContext";
import { toggleBigPicture } from "../bigpicture/mode";
import { openShortcuts } from "../components/ShortcutsHelp";
import { openExternalUrl } from "./platform";
import { requestPicker } from "./pickerRequest";
import { isNextUp } from "./backlog";
import { selectLaunchProfile } from "./launchProfiles";
import type { Piko } from "../models";
import { gameSearchAvailable, gameSearchBackendOverride, openGameSearch } from "./gameSearch";

const DOCS_URL = "https://github.com/T1nkiePlayz/Mochi/tree/main/docs";
const ISSUES_URL = "https://github.com/T1nkiePlayz/Mochi/issues";

const NAV: Array<[NavId, string, string[]]> = [
  ["Library", "Go to Library", ["games", "home", "pikos"]],
  ["Discover", "Go to Discover", ["mods", "browse", "modrinth", "curseforge"]],
  ["Installed", "Go to Mods & Content", ["installed", "mods", "tofus"]],
  ["Downloads", "Go to Downloads", ["queue", "transfers"]],
  ["Stats", "Go to Stats", ["playtime", "achievements", "statistics"]],
  ["Deals", "Go to Deals", ["price", "sale", "free", "wishlist", "news"]],
  ["Settings", "Go to Settings", ["preferences", "options"]],
];

/** Settings sections: id matches `settingsSections` and the `settings-<id>` anchor on the page. */
export const SETTINGS_SECTIONS: Array<[string, string, string[]]> = [
  ["appearance", "Appearance", ["theme", "colors", "layout"]], ["accessibility", "Accessibility", ["a11y", "text size", "contrast", "motion"]],
  ["providers", "Mod & metadata providers", ["igdb", "steamgriddb", "api key", "credentials"]], ["modsources", "Mod sources", ["modrinth", "curseforge", "nexus"]],
  ["general", "General", ["launch", "startup", "behavior"]], ["controller", "Controller", ["gamepad", "buttons", "rumble"]],
  ["bigpicture", "Big Picture & Steam Deck", ["tv", "fullscreen", "deck"]], ["sound", "Sound", ["audio", "sound packs", "volume"]],
  ["security", "Security", ["password", "2fa", "sign in"]], ["updates", "Updates", ["version", "upgrade"]],
  ["achievements", "Achievements", ["trophies", "unlocks"]], ["data", "Data & privacy", ["storage", "export", "cache", "reset"]],
  ["experimental", "Experimental features", ["labs", "beta"]], ["help", "Help & feedback", ["support", "issues", "dashboard"]],
];

/** Scrolls to a Settings section once the (lazy) page has rendered it. */
export function scrollToSettingsSection(id: string, tries = 40) {
  const target = document.getElementById(`settings-${id}`);
  if (target) { target.scrollIntoView({ block: "start" }); return; }
  if (tries > 0) window.setTimeout(() => scrollToSettingsSection(id, tries - 1), 50);
}

/** Registers the built-in commands. Returns one function that removes them all. */
export function registerBuiltinCommands(): () => void {
  const off: Array<() => void> = [];
  for (const [nav, title, keywords] of NAV) off.push(register(`nav.${nav.toLowerCase()}`, title, keywords, "Navigate", ({ app }) => app().setActiveNav(nav)));
  for (const [id, title, keywords] of SETTINGS_SECTIONS) off.push(register(`settings.${id}`, `Settings: ${title}`, ["open", ...keywords], "Settings", ({ app }) => { app().setActiveNav("Settings"); scrollToSettingsSection(id); }));
  off.push(register("library.add", "Add game", ["new", "piko", "custom"], "Library", ({ app }) => { const a = app(); a.setActiveNav("Library"); a.add.setShowAddPiko(true); }));
  off.push(register("library.import", "Import games", ["steam", "launcher", "scan", "heroic", "lutris"], "Library", ({ app }) => { const a = app(); a.setActiveNav("Library"); a.add.openImportPicker("games"); }));
  off.push(register("mods.discover", "Install mod…", ["install", "mod", "search", "discover", "download"], "Mods", async ({ app }) => { const { openDiscoverWithQuery } = await import("./discoverQuery"); openDiscoverWithQuery("", app().setActiveNav); }));
  off.push(register("games.search", "Search all games", ["find", "lookup", "price", "wishlist", "igdb", "steamgriddb", "discover"], "Discover", () => { openGameSearch(); }, ({ app }) => {
    const a = app();
    return Boolean(gameSearchBackendOverride()) || gameSearchAvailable(a.credentials.status);
  }));
  off.push(register("library.picker", "What should I play?", ["pick", "random", "suggest", "choose", "decide"], "Library", ({ app }) => { app().setActiveNav("Library"); requestPicker(); }, ({ app }) => app().lib.library.some((piko) => piko.kind !== "launcher")));
  off.push(register("library.covers", "Find missing covers", ["artwork", "cover", "images", "metadata", "fetch"], "Library", ({ app }) => { const a = app(); void a.metadata.findMissingCovers(a.lib.library); }, ({ app }) => { const a = app(); return !a.metadata.refreshBusy && a.metadata.missingCovers(a.lib.library).length > 0; }));
  off.push(register("library.nextup", "Play next up game", ["backlog", "queue", "next"], "Library", async ({ app }) => {
    const a = app(); const piko = a.lib.library.find(isNextUp);
    if (piko) { a.lib.selectPiko(piko); await a.actions.launchGame(piko); }
  }, ({ app }) => app().lib.library.some(isNextUp)));
  off.push(register("library.resume", "Play last played game", ["resume", "continue", "recent"], "Library", async ({ app }) => {
    const a = app(); const last = [...a.lib.playtimeById.values()].filter((entry) => entry.lastPlayed > 0 && a.lib.library.some((piko) => piko.id === entry.gameId)).sort((x, y) => y.lastPlayed - x.lastPlayed)[0];
    const piko = last && a.lib.library.find((item) => item.id === last.gameId);
    if (piko) { a.lib.selectPiko(piko); await a.actions.launchGame(piko); }
  }, ({ app }) => app().lib.playtimeById.size > 0));
  off.push(register("library.stop", "Stop running game", ["quit", "close", "kill"], "Library", async ({ app }) => {
    const a = app(); for (const piko of a.lib.library.filter((item) => a.sessions.isRunning(item.id))) await a.actions.stopRunningGame(piko);
  }, ({ app }) => app().sessions.sessions.length > 0));
  off.push(register("downloads.toggle", "Pause or resume downloads", ["download", "pause", "resume", "queue"], "Mods", ({ app }) => { app().downloadPacing.setPrefs((current) => ({ ...current, paused: !current.paused })); }));
  off.push(register("theme.gamethemes", "Toggle game themes", ["accent", "colour", "color", "cover"], "Theme", ({ app }) => { app().setBehavior((current) => ({ ...current, gameThemes: !current.gameThemes })); }));
  off.push(register("tofu.manage", "Open Tofu manager", ["tofu", "profile", "instance"], "Library", ({ app }) => app().setShowTofuManager(true), ({ app }) => app().lib.library.some((piko) => piko.id === app().lib.selectedPiko.id)));
  off.push(register("mods.snapshot", "Create snapshot of current Tofu", ["backup", "mods", "restore point"], "Mods", async ({ app }) => {
    const a = app(); const tofu = a.lib.selectedTofu;
    const { createTofuSnapshot, snapshotFolders } = await import("./mods/snapshots");
    try { await createTofuSnapshot(tofu.id, snapshotFolders(tofu), "Manual (command palette)"); a.notifications.notify("Snapshot saved", `${a.lib.selectedPiko.name} / ${tofu.name}`); }
    catch (error) { a.notifications.notify("Snapshot failed", error instanceof Error ? error.message : String(error)); }
  }, ({ app }) => Boolean(app().lib.selectedTofu?.path)));
  off.push(register("mods.check", "Check mods for updates", ["update", "outdated", "mods"], "Mods", async ({ app }) => {
    const a = app(); const tofu = a.lib.selectedTofu;
    a.notifications.notify("Checking mods", `${a.lib.selectedPiko.name} / ${tofu.name}`);
    const check = await ensureChecked(tofu, a.lib.selectedPiko, a.behavior.modSources, true).catch(() => undefined);
    a.notifications.notify("Mod check finished", check ? (check.items.length ? `${check.items.length} update${check.items.length === 1 ? "" : "s"} available.` : "Everything is up to date.") : "The check could not finish.");
  }, ({ app }) => Boolean(app().lib.selectedTofu?.path)));
  off.push(register("bigpicture.toggle", "Toggle Big Picture", ["tv", "controller", "fullscreen", "deck"], "Navigate", () => toggleBigPicture()));
  off.push(register("help.shortcuts", "Show keyboard shortcuts", ["keys", "help", "hotkeys"], "Help", () => { openShortcuts(); }));
  off.push(register("help.docs", "Open documentation", ["docs", "help", "guide", "wiki"], "Help", () => { void openExternalUrl(DOCS_URL).catch(() => undefined); }));
  off.push(register("help.issues", "Report a problem (GitHub issues)", ["bug", "feedback", "issue"], "Help", () => { void openExternalUrl(ISSUES_URL).catch(() => undefined); }));
  return () => off.forEach((fn) => fn());
}

/** One "Theme: <name>" command per available theme; call again when the list changes. */
export function registerThemeCommands(themes: ReadonlyArray<{ id: string; name: string }>, setTheme: (id: string) => void): () => void {
  const off = themes.map((theme) => register(`theme.${theme.id}`, `Theme: ${theme.name}`, ["switch", "appearance", "colors", "dark", "light"], "Theme", () => setTheme(theme.id)));
  return () => off.forEach((fn) => fn());
}

/** "Launch profile: <game> / <profile>" for every game that has profiles (and a way back to its default options). */
export function registerLaunchProfileCommands(games: ReadonlyArray<Pick<Piko, "id" | "name" | "launchProfiles" | "activeLaunchProfile" | "launchOptions">>, setProfile: (gameId: string, profileId: string | undefined) => void): () => void {
  const off: Array<() => void> = [];
  for (const game of games) {
    if (!game.launchProfiles?.length) continue;
    off.push(register(`profile.${game.id}.default`, `Launch profile: ${game.name} / Default options`, ["profile", "launch", "runtime", "proton", "wine"], "Library", () => setProfile(game.id, undefined)));
    for (const profile of game.launchProfiles) off.push(register(`profile.${game.id}.${profile.id}`, `Launch profile: ${game.name} / ${profile.name}`, ["profile", "launch", "runtime", "proton", "wine"], "Library", () => setProfile(game.id, selectLaunchProfile(game, profile.id))));
  }
  return () => off.forEach((fn) => fn());
}
