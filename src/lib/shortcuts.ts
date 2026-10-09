import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";

export type ShortcutLocation = { id: "menu" | "desktop" | "applications"; label: string; path: string };
export type SteamUser = { id: string; name: string; path: string };
export type ShortcutTargets = { locations: ShortcutLocation[]; steamUsers: SteamUser[]; steamRunning: boolean };
export type AddToSteamResult = { status: "added" | "exists" | "steam-running"; backup: string | null };

export const getShortcutTargets = () => invoke<ShortcutTargets>("get_shortcut_targets");
export const createPikoShortcut = (game: Piko, location: string) => invoke<string>("create_piko_shortcut", { gameId: game.id, name: game.name, artworkCacheKey: game.artworkCacheKey ?? null, location });
export const addPikoToSteam = (game: Piko, userId: string, allowRunning: boolean) => invoke<AddToSteamResult>("add_piko_to_steam", { gameId: game.id, name: game.name, artworkCacheKey: game.artworkCacheKey ?? null, userId, allowRunning });

export type ShortcutMenuItem = { key: string; label: string; hint?: string } & ({ kind: "location"; location: string } | { kind: "steam"; userId: string });

/** Menu rows for the "Shortcuts" popover: one per place a launcher can go, one per Steam account. */
export function shortcutMenuItems(targets: ShortcutTargets | null): ShortcutMenuItem[] {
  if (!targets) return [];
  const items: ShortcutMenuItem[] = targets.locations.map((location) => ({ key: `location:${location.id}`, kind: "location", location: location.id, label: `Create shortcut: ${location.label}`, hint: location.path }));
  const many = targets.steamUsers.length > 1;
  for (const user of targets.steamUsers) items.push({ key: `steam:${user.id}`, kind: "steam", userId: user.id, label: many ? `Add to Steam: ${user.name}` : "Add to Steam", hint: many ? `Account ${user.id}` : undefined });
  return items;
}

type SteamDeps = {
  confirm: (request: { title: string; message: string; confirmLabel: string; danger?: boolean }) => Promise<boolean>;
  add: (userId: string, allowRunning: boolean) => Promise<AddToSteamResult>;
  notify: (title: string, message: string) => void;
};

/** Adds a game to Steam; when Steam is running it asks first, because Steam overwrites the file when it exits. */
export async function runAddToSteam(game: Pick<Piko, "name">, user: Pick<SteamUser, "id" | "name">, deps: SteamDeps): Promise<"added" | "exists" | "cancelled"> {
  let result = await deps.add(user.id, false);
  if (result.status === "steam-running") {
    const ok = await deps.confirm({ title: "Steam is running", message: "Steam rewrites its shortcut list when it closes, which can erase this entry. Close Steam first for a reliable result. Add it anyway? A backup of your shortcuts is made either way.", confirmLabel: "Add anyway" });
    if (!ok) return "cancelled";
    result = await deps.add(user.id, true);
  }
  if (result.status === "exists") { deps.notify("Already in Steam", `${game.name} is already in ${user.name}'s Steam library.`); return "exists"; }
  deps.notify("Added to Steam", `${game.name} was added for ${user.name}. Restart Steam to see it under Non-Steam games.`);
  return "added";
}
