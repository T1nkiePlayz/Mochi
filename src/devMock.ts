/**
 * Browser-only stand-in for the Tauri backend so the UI (and every theme) can be
 * developed with plain `npm run dev`. Loaded only in dev builds outside Tauri.
 */
type Handler = (args: Record<string, unknown>) => unknown;

const now = Math.floor(Date.now() / 1000);
const handlers: Record<string, Handler> = {
  get_steam_store_details: ({ appid }) => ({
    status: "ok", stale: false, fetchedAt: now, message: null,
    details: {
      appid, name: `Steam app ${appid}`, description: "Sample description from the Steam Store (development mock).", genres: ["Action", "Adventure"],
      screenshots: [], movies: [], developers: ["Mock Studio"], publishers: ["Mock Publisher"], releaseDate: 1_100_563_200, releaseDateText: "16 Nov, 2004",
      coverUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
      headerUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
      heroUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`,
    },
  }),
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
  check_launch_targets: (args) => ((args.targets as string[]) ?? []).map(() => true),
  prepare_artwork_preview: async (args) => {
    const image = await loadMockImage(String(args.source));
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = drawMock(image, 0, 0, image.naturalWidth, image.naturalHeight, Math.round(image.naturalWidth * scale), Math.round(image.naturalHeight * scale));
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.9), width: image.naturalWidth, height: image.naturalHeight };
  },
  save_custom_artwork: async (args) => {
    const image = await loadMockImage(String(args.source));
    const crop = args.crop as { x: number; y: number; width: number; height: number };
    const url = drawMock(image, crop.x * image.naturalWidth, crop.y * image.naturalHeight, crop.width * image.naturalWidth, crop.height * image.naturalHeight, 600, 800).toDataURL("image/jpeg", 0.9);
    const store = mockArtwork(); store[String(args.cacheKey)] = url; localStorage.setItem("mochi:dev-artwork", JSON.stringify(store));
    return url;
  },
  delete_game_artwork: (args) => { const store = mockArtwork(); delete store[String(args.cacheKey)]; localStorage.setItem("mochi:dev-artwork", JSON.stringify(store)); return null; },
  get_cached_game_artwork: (args) => mockArtwork()[String(args.cacheKey)] ?? null,
  cache_game_artwork: () => null,
  "plugin:dialog|open": (args) => {
    const options = (args.options ?? {}) as { filters?: Array<{ name: string }>; directory?: boolean };
    if (options.directory) return "/home/dev/Games";
    if (!options.filters?.some((filter) => filter.name === "Images")) return "/usr/bin/mock-game";
    return new Promise<string | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.onchange = () => { const file = input.files?.[0]; if (!file) return resolve(null); const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); };
      input.click();
    });
  },
  list_user_themes: () => [],
  cache_theme_fonts: () => "",
  get_mochi_config_info: () => ({ configPath: "~/.config/Mochi/config.json", themesPath: "~/.config/Mochi/themes", selectedTheme: localStorage.getItem("mochi:theme") ?? "mochi" }),
  set_mochi_theme: (args) => { localStorage.setItem("mochi:theme", String(args.themeId)); return null; },
  detect_import_sources: () => [
    { id: "steam", name: "Steam", description: "Games installed through Steam and its libraries.", detected: true, installed: true, gameCount: 240, launcherCount: 1 },
    { id: "heroic", name: "Heroic Games Launcher", description: "Epic, GOG and Amazon games managed by Heroic.", detected: true, installed: true, gameCount: 6, launcherCount: 0 },
    { id: "lutris", name: "Lutris", description: "Existing Lutris games and launch configurations.", detected: false, installed: true, gameCount: 0, launcherCount: 0 },
    { id: "apps", name: "Desktop applications", description: "Games registered in your application menu.", detected: true, installed: true, gameCount: 2, launcherCount: 3 },
  ],
  scan_import_games: (args) => {
    if (args.source === "steam") return [
      ...Array.from({ length: 240 }, (_, i) => ({ id: `steam:${1000 + i}`, name: `Steam Game ${String(i + 1).padStart(3, "0")}`, source: "steam", launchTarget: `steam://rungameid/${1000 + i}`, installPath: `/games/steam/game-${i}`, kind: "game", launcherId: null })),
      { id: "launcher:steam", name: "Steam", source: "steam", launchTarget: "steam://open/main", installPath: null, kind: "launcher", launcherId: "steam" },
    ];
    if (args.source === "heroic") return ["Hades", "Celeste", "Control", "Dishonored 2", "Fez", "Inside"].map((name) => ({ id: `heroic:${name}`, name, source: "heroic", launchTarget: `heroic://launch?appName=${name}`, installPath: `/games/heroic/${name}`, kind: "game", launcherId: null }));
    if (args.source === "apps") return [
      { id: "apps:supertux", name: "SuperTux", source: "apps", launchTarget: "supertux2", installPath: null, kind: "game", launcherId: null },
      { id: "apps:xonotic", name: "Xonotic", source: "apps", launchTarget: "xonotic", installPath: null, kind: "game", launcherId: null },
      { id: "apps:prism", name: "Prism Launcher", source: "apps", launchTarget: "prismlauncher", installPath: null, kind: "launcher", launcherId: "prism" },
      { id: "apps:jagex", name: "Jagex Launcher", source: "apps", launchTarget: "jagex-launcher", installPath: null, kind: "launcher", launcherId: "jagex" },
      { id: "apps:mcpe", name: "Minecraft Bedrock Launcher", source: "apps", launchTarget: "mcpelauncher-ui-qt", installPath: null, kind: "launcher", launcherId: "minecraft-bedrock" },
    ];
    return [];
  },
};

const mockArtwork = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem("mochi:dev-artwork") ?? "{}"); } catch { return {}; } };
const loadMockImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("That image could not be loaded."));
  image.src = source;
});
const drawMock = (image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")?.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  return canvas;
};

export function installDevMock() {
  const w = window as unknown as Record<string, unknown>;
  if ("__TAURI_INTERNALS__" in w) return;
  w.__MOCHI_DEV_MOCK__ = true; // lets src/lib/updater.ts fake an available update
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
