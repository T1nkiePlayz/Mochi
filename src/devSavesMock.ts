// Dev-server fakes for the save-backup commands (see src-tauri/src/savebackup.rs).
type Handler = (args: Record<string, unknown>) => unknown;
type Backup = { id: string; locationKey: string; createdAt: number; size: number; entries: number; files: number; kind: string; fingerprint: string };

const DAY = 86_400_000;
const base = Date.now();
const locations = [
  { key: "mc-a1", kind: "minecraft", label: "Survival World", group: "Fabric 1.21", path: "/home/dev/.local/share/PrismLauncher/instances/Fabric 1.21/.minecraft/saves/Survival World", source: null, problem: null },
  { key: "mc-a2", kind: "minecraft", label: "Creative Test", group: "Fabric 1.21", path: "/home/dev/.local/share/PrismLauncher/instances/Fabric 1.21/.minecraft/saves/Creative Test", source: null, problem: null },
  { key: "st-1", kind: "steam", label: "Steam Cloud saves (account 1234)", group: null, path: "/home/dev/.local/share/Steam/userdata/1234/480/remote", source: null, problem: null },
];
const store: Record<string, Backup[]> = {
  "mc-a1": [2, 1, 0].map((n, index) => ({ id: `mc-a1~${base - n * DAY}`, locationKey: "mc-a1", createdAt: base - n * DAY, size: 48_000_000 + index * 3_000_000, entries: 400, files: 380, kind: index === 1 ? "safety" : index === 2 ? "auto" : "manual", fingerprint: String(index) })).reverse(),
};
let settings = { keep: 10, maxTotalBytes: 2 * 1024 ** 3 };

export const saveHandlers: Record<string, Handler> = {
  list_save_locations: (args) => {
    const extra = ((args.hints as { folders?: string[] } | undefined)?.folders ?? []).map((folder, index) => ({ key: `cu-${index}`, kind: "custom", label: folder.split("/").pop() ?? folder, group: null, path: folder, source: folder, problem: null }));
    return [...locations, ...extra].map((location) => {
      const list = store[location.key] ?? [];
      return { ...location, backups: list.length, lastBackup: list[0]?.createdAt ?? null, backupBytes: list.reduce((sum, backup) => sum + backup.size, 0) };
    });
  },
  list_save_backups: ({ locationKey }) => store[String(locationKey)] ?? [],
  create_save_backup: ({ location }) => {
    const path = String((location as { path: string }).path);
    const key = locations.find((item) => item.path === path)?.key ?? `cu-${path}`;
    const at = Date.now();
    const backup: Backup = { id: `${key}~${at}`, locationKey: key, createdAt: at, size: 12_000_000, entries: 90, files: 80, kind: "manual", fingerprint: String(at) };
    store[key] = [backup, ...(store[key] ?? [])];
    return { backup, skipped: null };
  },
  restore_save_backup: () => ({ safety: { id: "x~1", kind: "safety" }, files: 380 }),
  delete_save_backup: ({ id }) => { for (const key of Object.keys(store)) store[key] = (store[key] ?? []).filter((backup) => backup.id !== id); },
  auto_backup_saves: () => ({ created: 0, unchanged: 0, failed: 0, firstError: null }),
  get_save_backup_settings: () => settings,
  set_save_backup_settings: ({ settings: next }) => { settings = next as typeof settings; return settings; },
};
