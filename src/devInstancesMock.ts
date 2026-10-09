// Dev-server fakes for the per-Tofu mod commands, game logs and download controls (see src-tauri/src/{modinstance,modlocs,gamelogs}.rs).
type Handler = (args: Record<string, unknown>) => unknown;

type Mod = { filename: string; path: string; enabled: boolean; size: number; record?: Record<string, unknown> };
const mods: Mod[] = [
  { filename: "sodium-0.6.0.jar", path: "/mods/sodium-0.6.0.jar", enabled: true, size: 912_000, record: { file: "sodium-0.6.0.jar", subdir: "", enabled: true, source: "modrinth", projectId: "AANobbMI", fileId: "v1", version: "0.6.0", title: "Sodium", installedAt: 1, rollback: { file: "sodium-0.5.9.jar", version: "0.5.9", fileId: "v0" } } },
  { filename: "lithium.jar.disabled", path: "/mods/lithium.jar.disabled", enabled: false, size: 402_000, record: { file: "lithium.jar", subdir: "", enabled: false, source: "curseforge", projectId: "360438", fileId: "55", version: "0.12.0", title: "Lithium", installedAt: 1, fileDate: "2025-01-01T00:00:00Z" } },
  { filename: "unknown-mod.jar", path: "/mods/unknown-mod.jar", enabled: true, size: 55_000 },
];
const logs: Record<string, string> = {};
const logText = (sessionId: string) => logs[sessionId] ??= "# Mochi launched /usr/bin/mock-game\n[12:00:01] Loading assets...\n[12:00:03] Fabric loader 0.15.7 ready\n[12:00:04] [WARN] Missing texture: block/mock\n";

export const instanceHandlers: Record<string, Handler> = {
  list_instance_mods: () => mods.map((mod) => ({ ...mod })),
  set_instance_mods_enabled: (args) => {
    let changed = 0;
    for (const path of args.paths as string[]) {
      const mod = mods.find((item) => item.path === path);
      if (!mod || mod.enabled === args.enabled) continue;
      mod.enabled = Boolean(args.enabled);
      mod.filename = mod.enabled ? mod.filename.replace(/\.disabled$/, "") : `${mod.filename}.disabled`;
      mod.path = mod.enabled ? mod.path.replace(/\.disabled$/, "") : `${mod.path}.disabled`;
      changed += 1;
    }
    return { changed, failed: [] };
  },
  delete_mod_file: (args) => { const index = mods.findIndex((item) => item.path === args.path); if (index >= 0) mods.splice(index, 1); return null; },
  get_instance_store_dir: (args) => `/home/dev/.local/share/Mochi/instances/${String(args.tofuId)}/files`,
  import_mods_from_folder: () => 3,
  rollback_mod_update: () => "sodium-0.5.9.jar",
  record_instance_mod: () => null,
  sync_instance_mods: () => ({ added: 2, removed: 1, unchanged: 5, conflicts: [], errors: [] }),
  detect_mod_locations: (args) => args.minecraft
    ? [
      { id: "a", label: "Prism Launcher: Fabric Pack", launcher: "Prism Launcher", instance: "Fabric Pack", modsDir: "/home/dev/.local/share/PrismLauncher/instances/Fabric Pack/.minecraft/mods", contentRoot: "/home/dev/.local/share/PrismLauncher/instances/Fabric Pack/.minecraft", exists: true, loader: "fabric", gameVersion: "1.20.1" },
      { id: "b", label: "Minecraft Launcher", launcher: "Minecraft Launcher", modsDir: "/home/dev/.minecraft/mods", contentRoot: "/home/dev/.minecraft", exists: true, loader: "vanilla", gameVersion: "1.21.1" },
    ]
    : [{ id: "c", label: "Mods folder", launcher: "Game folder", modsDir: "/home/dev/Games/Mock/Mods", exists: true }],
  cancel_mod_download: () => null,
  clear_finished_downloads: () => null,
  list_game_logs: () => ({ dir: "/home/dev/.local/share/Mochi/logs/mock", sessions: [
    { id: "1700000000000-direct", startedAt: 1_700_000_000_000, size: 4096, direct: true },
    { id: "1699990000000-handoff", startedAt: 1_699_990_000_000, size: 80, direct: false },
  ] }),
  read_game_log: (args) => {
    const text = logText(String(args.sessionId));
    const from = typeof args.from === "number" ? args.from : 0;
    if (from > text.length) return { text, offset: text.length, size: text.length, reset: true, cutStart: false };
    return { text: text.slice(from), offset: text.length, size: text.length, reset: false, cutStart: false };
  },
  clear_game_logs: () => 2,
};
