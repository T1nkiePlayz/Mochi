/**
 * Browser-only stand-in for the Tauri backend so the UI (and every theme) can be
 * developed with plain `npm run dev`. Loaded only in dev builds outside Tauri.
 */
type Handler = (args: Record<string, unknown>) => unknown;


/** Fake Modrinth API: paged search over generated projects, the game version tag list and project pages. */
const fakeProjects = (type: string) => Array.from({ length: 420 }, (_, index) => ({
  project_id: `${type}-${index}`, slug: `${type}-${index}`, title: `${type === "mod" ? "Mod" : type} project ${index + 1}`,
  description: "A generated project used to exercise paging and infinite scroll in the dev server.", project_type: type,
  downloads: 5_000_000 - index * 9_000, author: `author${index % 17}`, categories: ["fabric", "forge"], icon_url: undefined, loaders: ["fabric"],
}));
const fakeVersions = [
  ...["26.4-snapshot-3", "26.4-snapshot-2", "26.3-rc-1"].map((version, i) => ({ version, version_type: "snapshot", date: `2026-09-${28 - i}T00:00:00Z`, major: false })),
  { version: "26.3", version_type: "release", date: "2026-09-15T00:00:00Z", major: false },
  { version: "26.2", version_type: "release", date: "2026-06-15T00:00:00Z", major: false },
  { version: "26.1", version_type: "release", date: "2026-03-15T00:00:00Z", major: true },
  ...["1.21.11", "1.21.8", "1.21.4", "1.21.1", "1.21", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5", "1.12.2", "1.8.9"].map((version, i) => ({ version, version_type: "release", date: new Date(Date.UTC(2025, 9, 1) - i * 86_400_000 * 60).toISOString(), major: false })),
  { version: "24w14potato", version_type: "snapshot", date: "2024-04-01T00:00:00Z", major: false },
  { version: "b1.7.3", version_type: "beta", date: "2011-07-08T00:00:00Z", major: false },
];
const apiResult = (data: unknown) => ({ data, cached: false, stale: false, fetchedAt: Date.now() });

const now = Math.floor(Date.now() / 1000);
const handlers: Record<string, Handler> = {
  get_public_api: (args) => {
    const url = new URL(String(args.url));
    if (url.pathname === "/v2/tag/game_version") return apiResult(fakeVersions);
    if (url.pathname === "/v2/search") {
      const facets = JSON.parse(url.searchParams.get("facets") || "[]") as string[][];
      const type = facets.flat().find((facet) => facet.startsWith("project_type:"))?.split(":")[1] ?? "mod";
      const text = (url.searchParams.get("query") || "").toLowerCase();
      const all = fakeProjects(type).filter((project) => !text || project.title.toLowerCase().includes(text));
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || 10);
      return apiResult({ hits: all.slice(offset, offset + limit), offset, limit, total_hits: all.length });
    }
    if (/\/members$/.test(url.pathname)) return apiResult([]);
    if (/\/version$/.test(url.pathname)) return apiResult([]);
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    return apiResult({ ...fakeProjects("mod")[0], project_id: id, title: id, body: "Generated project description.", followers: 1200 });
  },
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
