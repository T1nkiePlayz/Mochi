/**
 * Browser-only stand-in for the Tauri backend so the UI (and every theme) can be
 * developed with plain `npm run dev`. Loaded only in dev builds outside Tauri.
 */
type Handler = (args: Record<string, unknown>) => unknown;

const now = Math.floor(Date.now() / 1000);

/** Deterministic pseudo-random history (about 14 months) so Stats and achievements have something to show. */
function mockHistory(): unknown[] {
  const games = [["a", "Minecraft", 0.9], ["b", "Stardew Valley", 0.55], ["c", "Subnautica", 0.3], ["d", "Terraria", 0.25], ["e", "Hades", 0.2], ["f", "Celeste", 0.12]] as const;
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const out: unknown[] = [{ gameId: "a", name: "Minecraft", start: now - 500 * 86_400, seconds: 40 * 3600, kind: "historic", count: 0 }];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let day = 430; day >= 0; day -= 1) {
    const base = new Date(today); base.setDate(base.getDate() - day);
    const weekend = base.getDay() === 0 || base.getDay() === 6;
    if (rnd() > (weekend ? 0.8 : 0.5)) continue;
    const sessions = 1 + Math.floor(rnd() * (weekend ? 3 : 2));
    for (let i = 0; i < sessions; i += 1) {
      const pick = games.find(([, , weight]) => rnd() < weight) ?? games[0];
      const hour = rnd() < 0.08 ? Math.floor(rnd() * 5) : 17 + Math.floor(rnd() * 7);
      const start = Math.floor(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, Math.floor(rnd() * 60)).getTime() / 1000);
      const seconds = Math.floor((900 + rnd() * rnd() * 5 * 3600));
      if (start + seconds > now) continue;
      out.push({ gameId: pick[0], name: pick[1], start, seconds, kind: day > 400 ? "daily" : "session", count: day > 400 ? 1 : 1 });
    }
  }
  return out;
}
const handlers: Record<string, Handler> = {
  get_playtime_history: (args) => { const since = Number(args.sinceEpoch ?? 0); return mockHistory().filter((r) => { const x = r as { start: number; seconds: number; kind: string }; return x.kind === "historic" || x.start + x.seconds >= since; }); },
  get_dir_size: () => ({ bytes: 412_000_000, files: 1_284, truncated: false }),
  analyze_mod_files: () => [
    { filename: "sodium-0.6.jar", path: "/mods/sodium-0.6.jar", enabled: true, projectId: "AANobbMI", title: "Sodium", currentVersion: "0.6.0", update: { versionId: "v2", versionNumber: "0.6.3", filename: "sodium-0.6.3.jar", url: "https://cdn.modrinth.com/x", size: 930_000 } },
    { filename: "lithium.jar.disabled", path: "/mods/lithium.jar.disabled", enabled: false, projectId: "gvQqBUqZ", title: "Lithium", currentVersion: "0.12.0" },
  ],
  update_mod_file: () => null,
  open_path_in_file_manager: () => null,
  get_platform_capabilities: () => ({
    platform: "linux", displayName: "Linux", launchMethods: ["file", "flatpak", "custom"], supportsFlatpak: true,
    supportsAppBundles: false, supportsStartup: true, supportsSystemNotifications: true, supportsShortcuts: true,
  }),
  get_playtime: () => [
    { gameId: "a", name: "Minecraft", seconds: 93_600, lastPlayed: now - 3_600 },
    { gameId: "b", name: "Stardew Valley", seconds: 41_000, lastPlayed: now - 86_400 },
    { gameId: "c", name: "Subnautica", seconds: 12_300, lastPlayed: now - 5 * 86_400 },
  ],
  get_active_sessions: () => [],
  list_runtimes: () => [
    { id: "wine", name: "Wine", kind: "compat", path: "/usr/bin/wine" },
    { id: "gamemoderun", name: "GameMode", kind: "wrapper", path: "/usr/bin/gamemoderun" },
    { id: "mangohud", name: "MangoHud", kind: "wrapper", path: "/usr/bin/mangohud" },
  ],
  get_downloads: () => [
    { id: "d1", tofuId: "default", tofuName: "Default", itemName: "Sodium", filename: "sodium-0.6.jar", downloaded: 3_200_000, total: 8_000_000, status: "downloading", createdAt: Date.now() },
    { id: "d2", tofuId: "default", tofuName: "Default", itemName: "Iris Shaders", filename: "iris-1.8.jar", downloaded: 2_000_000, total: 2_000_000, status: "completed", createdAt: Date.now() - 1000, finishedAt: Date.now() },
    { id: "d3", tofuId: "modded", tofuName: "Modded", itemName: "Lithium", filename: "lithium.jar", downloaded: 0, status: "failed", error: "Modrinth download failed (404).", createdAt: Date.now() - 2000, finishedAt: Date.now() },
  ],
  list_mod_files: () => [
    { filename: "sodium-0.6.jar", path: "/mods/sodium-0.6.jar", enabled: true, size: 912_000 },
    { filename: "lithium.jar.disabled", path: "/mods/lithium.jar.disabled", enabled: false, size: 402_000 },
  ],
  list_user_themes: () => [],
  get_mochi_config_info: () => ({ configPath: "~/.config/Mochi/config.json", themesPath: "~/.config/Mochi/themes", selectedTheme: localStorage.getItem("mochi:theme") ?? "mochi" }),
  set_mochi_theme: (args) => { localStorage.setItem("mochi:theme", String(args.themeId)); return null; },
  detect_import_sources: () => [
    { id: "steam", name: "Steam", description: "Games installed through Steam and its libraries.", detected: true, gameCount: 24 },
    { id: "heroic", name: "Heroic Games Launcher", description: "Epic, GOG and Amazon games managed by Heroic.", detected: true, gameCount: 6 },
    { id: "apps", name: "Desktop applications", description: "Games registered in your application menu.", detected: true, gameCount: 3 },
  ],
  scan_import_games: () => [
    { id: "steam:220", name: "Half-Life 2", source: "steam", launchTarget: "steam://rungameid/220", installPath: "/games/hl2" },
    { id: "steam:105600", name: "Terraria", source: "steam", launchTarget: "steam://rungameid/105600", installPath: "/games/terraria" },
  ],
};

export function installDevMock() {
  const w = window as unknown as Record<string, unknown>;
  if ("__TAURI_INTERNALS__" in w) return;
  w.__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      const handler = handlers[command];
      if (!handler) throw new Error(`devMock: ${command} is not available outside Tauri`);
      return handler(args);
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  };
}
