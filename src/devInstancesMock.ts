// Dev-server fakes for the per-Tofu mod commands, game logs and download controls (see src-tauri/src/{modinstance,modlocs,gamelogs}.rs).
type Handler = (args: Record<string, unknown>) => unknown;

type Mod = { filename: string; path: string; enabled: boolean; size: number; record?: Record<string, unknown> };
const mods: Mod[] = [
  { filename: "sodium-0.6.0.jar", path: "/mods/sodium-0.6.0.jar", enabled: true, size: 912_000, record: { file: "sodium-0.6.0.jar", subdir: "", enabled: true, source: "modrinth", projectId: "AANobbMI", fileId: "v1", version: "0.6.0", title: "Sodium", installedAt: 1, rollback: { file: "sodium-0.5.9.jar", version: "0.5.9", fileId: "v0" } } },
  { filename: "lithium.jar.disabled", path: "/mods/lithium.jar.disabled", enabled: false, size: 402_000, record: { file: "lithium.jar", subdir: "", enabled: false, source: "curseforge", projectId: "360438", fileId: "55", version: "0.12.0", title: "Lithium", installedAt: 1, fileDate: "2025-01-01T00:00:00Z" } },
  { filename: "needs-api.jar", path: "/mods/needs-api.jar", enabled: true, size: 80_000, record: { file: "needs-api.jar", subdir: "", enabled: true, source: "modrinth", projectId: "NEEDSAPI", fileId: "v1", version: "1.0.0", title: "Needs API", installedAt: 2, requires: ["P7LgX9k2"], loaders: ["forge"], gameVersions: ["1.20.1"] } },
  { filename: "sodium-0.5.9.jar", path: "/mods/sodium-0.5.9.jar", enabled: true, size: 900_000, record: { file: "sodium-0.5.9.jar", subdir: "", enabled: true, source: "modrinth", projectId: "AANobbMI", fileId: "v0", version: "0.5.9", title: "Sodium", installedAt: 0 } },
  { filename: "unknown-mod.jar", path: "/mods/unknown-mod.jar", enabled: true, size: 55_000 },
  { filename: "other-tofu-mod.jar.disabled", path: "/mods/other-tofu-mod.jar.disabled", enabled: false, size: 12_000 },
];
let nxmRegistered = false;
const logs: Record<string, string> = {};
const logText = (sessionId: string) => logs[sessionId] ??= "# Mochi launched /usr/bin/mock-game\n[12:00:01] Loading assets...\n[12:00:03] Fabric loader 0.15.7 ready\n[12:00:04] [WARN] Missing texture: block/mock\n";

type MockSnapshot = { id: string; createdAt: number; reason: string; isRestore: boolean; files: number; size: number; folders: number; reused: boolean };
const hour = 3_600_000;
let snapshots: MockSnapshot[] = [
  { id: "s3", createdAt: Date.now() - 2 * hour, reason: "Before restore", isRestore: true, files: 41, size: 118_400_000, folders: 3, reused: false },
  { id: "s2", createdAt: Date.now() - 5 * hour, reason: "Before updating 6 mods", isRestore: false, files: 41, size: 118_100_000, folders: 3, reused: false },
  { id: "s1", createdAt: Date.now() - 30 * hour, reason: "Before updating Sodium", isRestore: false, files: 39, size: 112_900_000, folders: 3, reused: false },
];

export const instanceHandlers: Record<string, Handler> = {
  list_tofu_snapshots: () => snapshots,
  create_tofu_snapshot: (args) => { const made = { id: `s${Date.now()}`, createdAt: Date.now(), reason: String(args.reason ?? ""), isRestore: false, files: 41, size: 118_400_000, folders: 3, reused: false }; snapshots = [made, ...snapshots]; return made; },
  restore_tofu_snapshot: () => ({ restored: 4, removed: 1, unchanged: 36, safetySnapshotId: "s3" }),
  delete_tofu_snapshot: (args) => { snapshots = snapshots.filter((snapshot) => snapshot.id !== args.snapshotId); return null; },
  list_instance_mods: (args) => mods.map((mod) => ({ ...mod, modifiedMs: 1_700_000_000_000, foreign: Array.isArray(args.siblings) && mod.filename.startsWith("other-tofu") })),
  write_mochipack_file: (args) => String(args.path),
  read_mochipack_file: () => { throw new Error("Dev mock: paste a code instead."); },
  list_instance_records: () => mods.filter((mod) => mod.record).map((mod) => mod.record),
  hash_mod_files: (args) => (args.paths as string[]).map((path, index) => ({ path, filename: path.split("/").pop(), size: 1000, sha1: `${index}`.padStart(40, "a"), md5: `${index}`.padStart(32, "b"), fingerprint: 1000 + index })),
  modrinth_identify: () => ({}),
  record_instance_mods: (args) => {
    for (const entry of args.entries as Array<{ file: string; enabled: boolean; record: Record<string, unknown> }>) {
      const mod = mods.find((item) => item.filename.replace(/\.disabled$/, "") === entry.file);
      if (mod && (!mod.record || entry.record.source !== "manual")) mod.record = { file: entry.file, subdir: "", enabled: entry.enabled, installedAt: Date.now(), ...entry.record };
    }
    return (args.entries as unknown[]).length;
  },
  copy_instance_records: () => mods.filter((mod) => mod.record).length,
  read_tofu_manifest: () => null,
  write_tofu_manifest: () => null,
  restore_instance_records: () => 0,
  apply_tofu_mods: () => ({ added: 0, removed: 0, unchanged: 0, enabled: 2, disabled: 1, conflicts: [], errors: [] }),
  get_nxm_handler: () => ({ configurable: true, registered: nxmRegistered }),
  set_nxm_handler: (args) => { nxmRegistered = Boolean(args.enabled); return { configurable: true, registered: nxmRegistered }; },
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
      { id: "a", label: "Prism Launcher: Fabric Pack", launcher: "Prism Launcher", instance: "Fabric Pack", modsDir: "/home/dev/.local/share/PrismLauncher/instances/Fabric Pack/.minecraft/mods", contentRoot: "/home/dev/.local/share/PrismLauncher/instances/Fabric Pack/.minecraft", exists: true, loader: "fabric", gameVersion: "1.20.1", fileCount: 12, modifiedMs: 1_700_000_500_000 },
      { id: "b", label: "Minecraft Launcher", launcher: "Minecraft Launcher", modsDir: "/home/dev/.minecraft/mods", contentRoot: "/home/dev/.minecraft", exists: true, loader: "vanilla", gameVersion: "1.21.1", fileCount: 0, modifiedMs: 1_700_000_000_000 },
    ]
    : [{ id: "c", label: "Mods folder", launcher: "Game folder", modsDir: "/home/dev/Games/Mock/Mods", exists: true, fileCount: 3, modifiedMs: 1_700_000_000_000 }],
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
