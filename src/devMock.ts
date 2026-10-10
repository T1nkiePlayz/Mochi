/**
 * Browser-only stand-in for the Tauri backend so the UI (and every theme) can be
 * developed with plain `npm run dev`. Loaded only in dev builds outside Tauri.
 */
import { installModsMock } from "./devModsMock";
import { instanceHandlers } from "./devInstancesMock";
import { saveHandlers } from "./devSavesMock";
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
/** Pretend native events: the dev mock keeps the listeners `listen()` registers so mocked commands can emit to them. */
const eventListeners = new Map<string, Array<(message: { event: string; id: number; payload: unknown }) => void>>();
const callbacks = new Map<number, (message: never) => void>();
const emitMockEvent = (event: string, payload: unknown) => eventListeners.get(event)?.forEach((callback) => callback({ event, id: 0, payload }));
const mockScan = (() => {
  const mochi = [["artwork", "Artwork cache", "artwork", 186_000_000, "artworkCache"], ["themes", "Themes", "themes", 2_400_000, null], ["fonts", "Theme fonts", "themes", 5_100_000, null], ["sound-packs", "Sound packs", "sound", 3_300_000, null], ["logs", "Game logs", "logs", 41_000_000, "logs"], ["snapshots", "Snapshots", "snapshots", 612_000_000, "snapshots"], ["instances", "Mod records", "data", 900_000, null], ["prefixes", "Wine prefixes", "data", 3_900_000_000, null]] as const;
  const games = Array.from({ length: 1500 }, (_, index) => ({ id: `mock-${index}`, name: `Mock game ${index + 1}`, bytes: Math.round(((index * 7919) % 997 + 3) * 4_200_000) }));
  return { mochi, games };
})();
let storageJob = 0;
const storageHandlers: Record<string, Handler> = {
  "plugin:event|listen": (args) => { const list = eventListeners.get(String(args.event)) ?? []; const callback = callbacks.get(Number(args.handler)); if (callback) list.push(callback as never); eventListeners.set(String(args.event), list); return list.length; },
  "plugin:event|unlisten": () => undefined,
  scan_storage: (args) => {
    const job = (storageJob += 1);
    const request = args.request as { games: Array<{ id: string; name: string }>; tofus: Array<{ id: string; name: string }> };
    const locations = [
      ...mockScan.mochi.map(([key, name, category, , clear]) => ({ key: `mochi:${key}`, name, category, path: `/home/me/.config/Mochi/${key}`, clear, inside: null })),
      ...mockScan.games.map((game) => ({ key: `game:${game.id}`, name: game.name, category: "games", path: `/games/${game.id}`, clear: null, inside: null })),
      ...request.tofus.map((tofu) => ({ key: `tofu:${tofu.id}`, name: tofu.name, category: "mods", path: `/mods/${tofu.id}`, clear: null, inside: null })),
      { key: "mochi:rollback", name: "Mod rollback copies", category: "rollback", path: null, clear: "rollbackCopies", inside: "mods" },
      { key: "mochi:download-temp", name: "Unfinished downloads", category: "downloads", path: null, clear: "downloadTemp", inside: "mods" },
    ];
    const results: Array<[string, number]> = [...mockScan.mochi.map(([key, , , bytes]) => [`mochi:${key}`, bytes] as [string, number]), ...mockScan.games.map((game) => [`game:${game.id}`, game.bytes] as [string, number]), ...request.tofus.map((tofu, index) => [`tofu:${tofu.id}`, (index + 1) * 83_000_000] as [string, number]), ["mochi:rollback", 24_000_000], ["mochi:download-temp", 3_000_000]];
    // Results trickle in (with a growing partial number first) like the real scan.
    results.forEach(([key, bytes], index) => {
      setTimeout(() => emitMockEvent("storage-scan-progress", { job, key, bytes: Math.round(bytes * 0.4), files: 10, truncated: false, done: false, error: null }), 300 + index * 2);
      setTimeout(() => emitMockEvent("storage-scan-progress", { job, key, bytes, files: Math.max(1, Math.round(bytes / 90_000)), truncated: false, done: true, error: null }), 600 + index * 2);
    });
    setTimeout(() => emitMockEvent("storage-scan-finished", { job, cancelled: false }), 700 + results.length * 2);
    return { job, locations };
  },
  cancel_storage_scan: () => undefined,
  clear_storage_location: () => ({ files: 214, bytes: 186_000_000 }),
};
let mockSoundPacks: Array<Record<string, unknown> & { id: string }> = [];

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
/** Fake Steam achievements. App 440 simulates a private profile and 570 a game without achievements. */
function mockSteamAchievements(appid: number) {
  if (appid === 440) return { status: "private", stale: false, source: "community", steamId: "76561197960287930", message: "This Steam profile's game details are private, so achievements cannot be read." };
  if (appid === 570) return { status: "no-achievements", stale: false, source: "community", steamId: "76561197960287930", message: "This game has no Steam achievements." };
  const names = ["Welcome to City 17", "Lambda Locator", "Trusty Hardware", "Vorticough", "Secret Stash", "Shipmate", "Zombie Chopper", "Hidden Finale"];
  const achievements = names.map((name, index) => ({
    apiName: `MOCK_${index}`, name, description: index === 7 ? "" : `Mock description for ${name}.`, icon: null, iconGray: null,
    unlocked: index < 4, unlockedAt: index < 4 ? now - (index + 1) * 86_400 * 9 : null, hidden: index === 7,
  }));
  return { status: "ok", stale: false, source: "community", steamId: "76561197960287930", fetchedAt: now, data: { appid, gameName: `Steam app ${appid}`, achievements, unlocked: 4, total: names.length } };
}
const handlers: Record<string, Handler> = {
  ...instanceHandlers,
  ...saveHandlers,
  get_steam_achievements: ({ appid }) => mockSteamAchievements(Number(appid)),
  clear_steam_achievements_cache: () => undefined,
  clear_steam_store_cache: () => undefined,
  get_steam_achievement_totals: () => [{ appid: 220, steamId: "76561197960287930", unlocked: 18, total: 33, fetchedAt: now }],
  get_steam_store_details: ({ appid }) => ({
    status: "ok", stale: false, fetchedAt: now, message: null,
    details: {
      appid, name: `Steam app ${appid}`, description: "Sample description from the Steam Store (development mock).", genres: ["Action", "Adventure"],
      // Mixed sizes on purpose so the justified screenshot gallery can be checked in the browser.
      screenshots: ["header.jpg", "library_hero.jpg", "capsule_616x353.jpg", "library_600x900.jpg", "capsule_231x87.jpg"].map((file) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/${file}`),
      movies: [], developers: ["Mock Studio"], publishers: ["Mock Publisher"], releaseDate: 1_100_563_200, releaseDateText: "16 Nov, 2004",
      coverUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
      headerUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
      heroUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`,
    },
  }),
  get_playtime_history: (args) => { const since = Number(args.sinceEpoch ?? 0); return mockHistory().filter((r) => { const x = r as { start: number; seconds: number; kind: string }; return x.kind === "historic" || x.start + x.seconds >= since; }); },
  ...storageHandlers,
  get_dir_size: () => ({ bytes: 412_000_000, files: 1_284, truncated: false }),
  analyze_mod_files: () => [
    { filename: "sodium-0.6.jar", path: "/mods/sodium-0.6.0.jar", enabled: true, projectId: "AANobbMI", title: "Sodium", currentVersion: "0.6.0", update: { versionId: "v2", versionNumber: "0.6.3", filename: "sodium-0.6.3.jar", url: "https://cdn.modrinth.com/x", size: 930_000 } },
    { filename: "lithium.jar.disabled", path: "/mods/lithium.jar.disabled", enabled: false, projectId: "gvQqBUqZ", title: "Lithium", currentVersion: "0.12.0", update: { versionId: "v-lithium", versionNumber: "0.12.4", filename: "lithium-0.12.4.jar", url: "https://cdn.modrinth.com/l", size: 402_000 } },
    { filename: "iris-1.7.jar", path: "/mods/iris-1.7.jar", enabled: true, projectId: "YL57xq9U", title: "Iris Shaders", currentVersion: "1.7.0", update: { versionId: "v-iris", versionNumber: "1.8.0", filename: "iris-1.8.0.jar", url: "https://cdn.modrinth.com/i", size: 2_000_000 } },
  ],
  update_mod_file: () => null,
  start_mod_download: () => `mock-${Date.now()}`,
  open_path_in_file_manager: () => null,
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
    if (url.pathname.startsWith("/v2/version/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() || "");
      const notes: Record<string, string | null> = { "v2": "## Sodium 0.6.3\n\n- Fixed a crash when resizing the window\n- Improved chunk upload speed\n- Updated translations", "v-lithium": null, "v-iris": "### Iris 1.8.0\n\n- Support for new shader pack options\n- Fixed **shadow flicker** on some GPUs" };
      return apiResult({ id, project_id: id, name: id, version_number: "2", game_versions: ["1.21.1"], loaders: ["fabric"], featured: true, date_published: "2025-06-01T00:00:00Z", version_type: "release", changelog: notes[id] ?? null,
        dependencies: id === "v-iris" ? [{ project_id: "P7dR8mSH", dependency_type: "required" }] : [], files: [{ hashes: { sha1: "a".repeat(40) }, url: "https://cdn.modrinth.com/x", filename: `${id}.jar`, primary: true, size: 1000 }] });
    }
    if (/\/members$/.test(url.pathname)) return apiResult([]);
    if (/\/version$/.test(url.pathname)) {
      const project = url.pathname.split("/").slice(-2)[0] ?? "";
      // One real-looking Sodium version so the modpack import preview shows a ready mod next to unavailable ones.
      return apiResult(project === "AANobbMI" ? [{ id: "v1", project_id: project, name: "Sodium 0.6.0", version_number: "0.6.0", game_versions: ["1.21.1"], loaders: ["fabric"], featured: true, date_published: "2025-01-01T00:00:00Z", dependencies: [],
        files: [{ hashes: { sha1: "a".repeat(40) }, url: "https://cdn.modrinth.com/data/AANobbMI/versions/v1/sodium-0.6.0.jar", filename: "sodium-0.6.0.jar", primary: true, size: 912_000 }] }] : []);
    }
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    return apiResult({ ...fakeProjects("mod")[0], project_id: id, title: id, body: "Generated project description.", followers: 1200 });
  },
  get_platform_capabilities: () => ({
    platform: "linux", displayName: "Linux", launchMethods: ["file", "flatpak", "custom"], supportsFlatpak: true,
    supportsAppBundles: false, supportsStartup: true, supportsSystemNotifications: true, supportsShortcuts: true,
    isSteamDeck: new URLSearchParams(location.search).has("deck"), isGamescope: new URLSearchParams(location.search).has("gamescope"),
  }),
  self_install_status: () => null, self_install_verify: () => ({ status: "verified", detail: "Dev mock." }), self_install_apply: () => null, self_install_skip: () => null,
  open_external_url: () => null, launch_game_tracked: () => null, stop_game: () => null, list_flatpaks: () => [],
  set_launch_on_startup: () => null, send_system_notification: () => null, create_game_shortcut: () => "/mock.desktop",
  get_shortcut_targets: () => ({ locations: [{ id: "menu", label: "Application menu", path: "~/.local/share/applications" }, { id: "desktop", label: "Desktop", path: "~/Desktop" }], steamUsers: [{ id: "1234", name: "Ashton", path: "/mock/steam/1234" }, { id: "5678", name: "Guest", path: "/mock/steam/5678" }], steamRunning: false }),
  create_piko_shortcut: () => "/mock/mochi-game.desktop", add_piko_to_steam: () => ({ status: "added", backup: null }), remove_game_shortcut: () => null,
  get_system_status: () => ({ hasBattery: true, batteryPercent: 76, charging: false }),
  get_gamepads: () => [],
  gamepad_rumble: () => null,
  suspend_system: () => null,
  get_power_capabilities: () => ({ suspend: true, restart: true, shutdown: true }),
  power_action: (args) => { throw new Error(`Dev mock: would ${String(args.action)} the system now.`); },
  quit_mochi: () => null,
  "plugin:window|set_fullscreen": () => null,
  "plugin:window|is_fullscreen": () => false,
  "plugin:window|minimize": () => null,
  // Sound packs: an in-memory list; the mock files are not real audio, so the built-in sounds play instead.
  list_sound_packs: () => mockSoundPacks,
  import_sound_pack: () => {
    const pack = { id: "dev-clicks", name: "Dev clicks", version: "1.0.0", author: "Mochi dev mock", description: "A pretend imported pack.", events: ["select", "back"], volume: 0.8, sizeBytes: 48_000 };
    mockSoundPacks = [...mockSoundPacks.filter((item) => item.id !== pack.id), pack];
    return pack;
  },
  remove_sound_pack: (args) => { mockSoundPacks = mockSoundPacks.filter((item) => item.id !== args.id); return null; },
  export_sound_pack: () => null,
  read_sound_pack_file: () => { throw new Error("Dev mock has no sound files."); },
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
  list_launch_runtimes: () => [
    { id: "wine", name: "Wine", kind: "compat", path: "/usr/bin/wine" },
    { id: "proton:/home/me/.steam/steam/compatibilitytools.d/GE-Proton9-27/proton", name: "GE-Proton9-27 (custom)", kind: "compat", path: "/home/me/.steam/steam/compatibilitytools.d/GE-Proton9-27/proton" },
    { id: "gamemoderun", name: "GameMode", kind: "wrapper", path: "/usr/bin/gamemoderun" },
    { id: "mangohud", name: "MangoHud", kind: "wrapper", path: "/usr/bin/mangohud" },
  ],
  // A small mirror of the launcher's own command builder, for the browser build only.
  preview_launch_command: (args) => {
    const request = args.request as { launchTarget: string; config: { args: string[]; env: Record<string, string>; wrappers: string[]; gamescope: { enabled: boolean; args: string[] }; runtime: string | null; workingDir: string | null } };
    const { launchTarget: target, config } = request;
    const quote = (word: string) => /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
    const env = Object.entries(config.env);
    const bad = env.filter(([key]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)).map(([key]) => `"${key}" is not a valid variable name. Use letters, digits and underscores, not starting with a digit.`);
    const base = { argv: [] as string[], env: [] as string[][], cwd: null, command: null, steamOptions: null, errors: bad, note: null };
    if (target.startsWith("steam://")) {
      const words = [...env.map(([key, value]) => `${key}=${quote(value)}`), ...(config.gamescope.enabled ? ["gamescope", ...config.gamescope.args.map(quote), "--"] : []), ...config.wrappers, "%command%", ...config.args.map(quote)];
      return { ...base, applies: "steam", note: "Steam starts this game itself. Paste the option string below into the game's Properties, Launch options in Steam.", steamOptions: bad.length ? null : words.join(" ") };
    }
    if (target.endsWith(".desktop")) return { ...base, applies: "none", errors: [], note: "Launch options cannot be passed through a .desktop entry. Point the launch target at the program itself to use them." };
    const argv = [...(config.gamescope.enabled ? ["/usr/bin/gamescope", ...config.gamescope.args, "--"] : []), ...config.wrappers.map((id) => `/usr/bin/${id}`), target, ...config.args];
    const prefix = [...(config.workingDir ? [`cd ${quote(config.workingDir)} &&`] : []), ...env.map(([key, value]) => `${key}=${quote(value)}`)];
    return { ...base, applies: "full", argv, env, cwd: config.workingDir, command: bad.length ? null : [...prefix, ...argv.map(quote)].join(" ") };
  },
  get_downloads: () => [
    { id: "d1", tofuId: "default", tofuName: "Default", itemName: "Sodium", filename: "sodium-0.6.jar", downloaded: 3_200_000, total: 8_000_000, status: "downloading", createdAt: Date.now(), provider: "modrinth", dir: "/mods", projectId: "AANobbMI" },
    { id: "d2", tofuId: "default", tofuName: "Default", itemName: "Iris Shaders", filename: "iris-1.8.jar", downloaded: 2_000_000, total: 2_000_000, status: "completed", createdAt: Date.now() - 1000, finishedAt: Date.now(), provider: "curseforge", dir: "/mods" },
    { id: "d3", tofuId: "modded", tofuName: "Modded", itemName: "Lithium", filename: "lithium.jar", downloaded: 0, status: "failed", error: "Modrinth download failed (404).", createdAt: Date.now() - 2000, finishedAt: Date.now(), provider: "nexus", dir: "/mods" },
  ],
  list_mod_files: () => [
    { filename: "sodium-0.6.jar", path: "/mods/sodium-0.6.0.jar", enabled: true, size: 912_000 },
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
  // Browser mock: no files on disk, so the "path" is the stored data URL (artworkCache passes data URLs through).
  get_cached_game_artwork_path: (args) => { const url = mockArtwork()[String(args.cacheKey)]; return url ? { path: url, version: 0 } : null; },
  cache_game_artwork: () => null,
  "plugin:dialog|save": () => "/home/dev/sound-pack.zip",
  // Paths answer with SVG markup (as real .svg icons do); the PNG the page rasterised becomes a 600x800 cover.
  cache_icon_cover: async (args) => {
    const key = String(args.cacheKey);
    const source = String(args.source);
    if (!args.replace && mockArtwork()[key]) return { cover: mockArtwork()[key], svg: null };
    if (source.startsWith("/")) {
      const letter = (source.split("/").pop() ?? "?").charAt(0).toUpperCase();
      return { cover: null, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#4a90d9"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${letter}</text></svg>` };
    }
    const image = await loadMockImage(source);
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 800;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 0, 800);
    gradient.addColorStop(0, "#2a3f57"); gradient.addColorStop(1, "#0c1219");
    context.fillStyle = gradient; context.fillRect(0, 0, 600, 800);
    context.drawImage(image, 150, 220, 300, 300);
    const url = canvas.toDataURL("image/jpeg", 0.9);
    const store = mockArtwork(); store[key] = url; localStorage.setItem("mochi:dev-artwork", JSON.stringify(store));
    return { cover: url, svg: null };
  },
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
    { id: "prism", name: "Minecraft instances", description: "Instances from Prism Launcher, PolyMC, MultiMC and Fjord Launcher.", detected: true, installed: true, gameCount: 2, launcherCount: 0 },
    { id: "battlenet", name: "Battle.net", description: "Blizzard games installed in Wine prefixes (Lutris, Bottles, Heroic).", detected: true, installed: true, gameCount: 2, launcherCount: 0 },
    { id: "gog", name: "GOG", description: "GOG games from the offline installers or Minigalaxy (~/GOG Games).", detected: false, installed: false, gameCount: 0, launcherCount: 0 },
    { id: "flatpak", name: "Flatpak", description: "Installed games delivered through Flatpak.", detected: true, installed: true, gameCount: 1, launcherCount: 2 },
    { id: "apps", name: "Desktop applications", description: "Games registered in your application menu.", detected: true, installed: true, gameCount: 2, launcherCount: 3 },
  ],
  scan_import_games: (args) => {
    if (args.source === "steam") return [
      ...Array.from({ length: 240 }, (_, i) => ({ id: `steam:${1000 + i}`, name: `Steam Game ${String(i + 1).padStart(3, "0")}`, source: "steam", launchTarget: `steam://rungameid/${1000 + i}`, installPath: `/games/steam/game-${i}`, kind: "game", launcherId: null })),
      { id: "steam:2000", name: "RuneScape: Dragonwilds Early Adopter Soundtrack", source: "steam", launchTarget: "steam://rungameid/2000", installPath: "/games/steam/soundtrack", kind: "game", launcherId: null, contentType: "soundtrack" },
      { id: "launcher:steam", name: "Steam", source: "steam", launchTarget: "steam://open/main", installPath: null, kind: "launcher", launcherId: "steam" },
    ];
    if (args.source === "heroic") return ["Hades", "Celeste", "Control", "Dishonored 2", "Fez", "Inside"].map((name) => ({ id: `heroic:${name}`, name, source: "heroic", launchTarget: `heroic://launch?appName=${name}`, installPath: `/games/heroic/${name}`, kind: "game", launcherId: null }));
    if (args.source === "apps") return [
      { id: "apps:supertux", name: "SuperTux", source: "apps", launchTarget: "supertux2", installPath: null, kind: "game", launcherId: null, iconPath: "/usr/share/icons/hicolor/scalable/apps/supertux.svg" },
      { id: "apps:xonotic", name: "Xonotic", source: "apps", launchTarget: "xonotic", installPath: null, kind: "game", launcherId: null, iconPath: "/usr/share/icons/hicolor/256x256/apps/xonotic.png" },
      { id: "apps:prism", name: "Prism Launcher", source: "apps", launchTarget: "prismlauncher", installPath: null, kind: "launcher", launcherId: "prism" },
      { id: "apps:jagex", name: "Jagex Launcher", source: "apps", launchTarget: "jagex-launcher", installPath: null, kind: "launcher", launcherId: "jagex" },
      { id: "apps:mcpe", name: "Minecraft Bedrock Launcher", source: "apps", launchTarget: "mcpelauncher-ui-qt", installPath: null, kind: "launcher", launcherId: "minecraft-bedrock" },
    ];
    if (args.source === "flatpak") return [
      { id: "flatpak:org.supertuxproject.SuperTux", name: "SuperTux", source: "flatpak", launchTarget: "flatpak://org.supertuxproject.SuperTux", installPath: null, kind: "game", launcherId: null, iconPath: null },
      { id: "flatpak:org.vinegarhq.Sober", name: "Sober", source: "flatpak", launchTarget: "flatpak://org.vinegarhq.Sober", installPath: null, kind: "launcher", launcherId: "sober", iconPath: null },
      { id: "flatpak:org.vinegarhq.Vinegar", name: "Vinegar", source: "flatpak", launchTarget: "flatpak://org.vinegarhq.Vinegar", installPath: null, kind: "launcher", launcherId: "vinegar", iconPath: null },
    ];
    if (args.source === "prism") return [
      { id: "prism:Fabric 1.21", name: "Fabric Fun", source: "prism", launchTarget: "mc-instance://prism/Fabric%201.21", installPath: "/home/dev/.local/share/PrismLauncher/instances/Fabric 1.21", kind: "game", launcherId: null, iconPath: null, minecraft: { version: "1.21.1", loader: "fabric", gameDir: "/home/dev/.local/share/PrismLauncher/instances/Fabric 1.21/minecraft" } },
      { id: "prism:Vanilla", name: "Vanilla 1.20", source: "prism", launchTarget: "mc-instance://prism/Vanilla", installPath: "/home/dev/.local/share/PrismLauncher/instances/Vanilla", kind: "game", launcherId: null, iconPath: null, minecraft: { version: "1.20.4", loader: "vanilla", gameDir: "/home/dev/.local/share/PrismLauncher/instances/Vanilla/.minecraft" } },
    ];
    if (args.source === "battlenet") return [
      { id: "battlenet:wow", name: "World of Warcraft", source: "battlenet", launchTarget: "battlenet-wine://%2Fhome%2Fdev%2FGames%2Fbattlenet/WoW", installPath: "/home/dev/Games/battlenet/drive_c/Program Files (x86)/World of Warcraft", kind: "game", launcherId: null },
      { id: "battlenet:hs_beta", name: "Hearthstone", source: "battlenet", launchTarget: "battlenet-wine://%2Fhome%2Fdev%2FGames%2Fbattlenet/WTCG", installPath: "/home/dev/Games/battlenet/drive_c/Program Files (x86)/Hearthstone", kind: "game", launcherId: null },
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
  installModsMock();
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  w.__MOCHI_DEV_MOCK__ = true; // lets src/lib/updater.ts fake an available update
  w.__TAURI_INTERNALS__ = {
    invoke: async (command: string, args: Record<string, unknown> = {}) => {
      const handler = handlers[command];
      if (!handler) throw new Error(`devMock: ${command} is not available outside Tauri`);
      return handler(args);
    },
    transformCallback: (callback: (message: never) => void) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; },
    unregisterCallback: () => {},
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  };
}
