/** Plugin manifests (`plugin.json`). Everything here is validated before a plugin is allowed to run. */
export type PluginPermission = "games.read" | "notify";
export const PLUGIN_PERMISSIONS: PluginPermission[] = ["games.read", "notify"];

export type PluginCommand = { id: string; title: string; keywords: string[] };
export type PluginManifest = { id: string; name: string; version: string; description: string; permissions: PluginPermission[]; commands: PluginCommand[] };
export type PluginFiles = { dir: string; manifest: string; script: string | null };
export type PluginEntry = { dir: string; manifest: PluginManifest | null; script: string | null; error: string };

const ID = /^[a-z0-9_-]{1,40}$/;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

/** Returns a manifest, or the reason the plugin cannot be used. */
export function parseManifest(raw: string, dir: string): { manifest: PluginManifest } | { error: string } {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { error: "plugin.json is not valid JSON." }; }
  if (!data || typeof data !== "object") return { error: "plugin.json must be an object." };
  const record = data as Record<string, unknown>;
  const id = text(record.id, 40);
  if (!ID.test(id)) return { error: "The plugin id must be 1-40 characters of a-z, 0-9, - or _." };
  if (id !== dir) return { error: `The plugin id "${id}" must match its folder name "${dir}".` };
  const name = text(record.name, 60);
  if (!name) return { error: "The plugin needs a name." };
  const permissions: PluginPermission[] = [];
  for (const item of Array.isArray(record.permissions) ? record.permissions : []) {
    if (!PLUGIN_PERMISSIONS.includes(item as PluginPermission)) return { error: `Unknown permission "${String(item)}".` };
    if (!permissions.includes(item as PluginPermission)) permissions.push(item as PluginPermission);
  }
  const commands: PluginCommand[] = [];
  for (const item of Array.isArray(record.commands) ? record.commands.slice(0, 20) : []) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const commandId = text(entry.id, 40);
    const title = text(entry.title, 80);
    if (!ID.test(commandId) || !title) return { error: "Every command needs an id (a-z, 0-9, - or _) and a title." };
    if (commands.some((command) => command.id === commandId)) return { error: `Duplicate command id "${commandId}".` };
    const keywords = (Array.isArray(entry.keywords) ? entry.keywords : []).filter((word): word is string => typeof word === "string").slice(0, 10).map((word) => word.slice(0, 30));
    commands.push({ id: commandId, title, keywords });
  }
  return { manifest: { id, name, version: text(record.version, 20) || "0.0.0", description: text(record.description, 200), permissions, commands } };
}

export function toEntry(files: PluginFiles): PluginEntry {
  const parsed = parseManifest(files.manifest, files.dir);
  if ("error" in parsed) return { dir: files.dir, manifest: null, script: null, error: parsed.error };
  if (!files.script && parsed.manifest.commands.length) return { dir: files.dir, manifest: parsed.manifest, script: null, error: "main.js is missing or too large." };
  return { dir: files.dir, manifest: parsed.manifest, script: files.script, error: "" };
}
