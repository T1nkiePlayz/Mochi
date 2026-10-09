import type { SupabaseClient } from "@supabase/supabase-js";
import type { AchievementFlags } from "./achievementTypes";

/** The part of the local achievement record that is worth syncing. Steam totals stay on the device (they come from its own cache). */
export type SyncedAchievements = {
  unlocked: Record<string, number>;
  flags: Pick<AchievementFlags, "themes" | "views" | "usedDiscover" | "installedMod" | "controllerUsed" | "bigPictureUsed">;
};

type LocalAchievements = SyncedAchievements & { flags: AchievementFlags };

const MAX_UNLOCKS = 1000;
const MAX_LIST = 200;
const MAX_TEXT = 100;

const text = (list: unknown): string[] =>
  Array.isArray(list) ? list.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, MAX_TEXT)).slice(0, MAX_LIST) : [];

/** Reads whatever the cloud holds and returns a safe value; the row is user-writable, so nothing in it is trusted. */
export function sanitiseCloudAchievements(raw: unknown): SyncedAchievements {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flags = (data.flags && typeof data.flags === "object" ? data.flags : {}) as Record<string, unknown>;
  const unlocked: Record<string, number> = {};
  if (data.unlocked && typeof data.unlocked === "object") {
    for (const [id, at] of Object.entries(data.unlocked as Record<string, unknown>).slice(0, MAX_UNLOCKS)) {
      if (typeof at === "number" && Number.isFinite(at) && at > 0) unlocked[id.slice(0, MAX_TEXT)] = at;
    }
  }
  return {
    unlocked,
    flags: {
      themes: text(flags.themes), views: text(flags.views),
      usedDiscover: flags.usedDiscover === true, installedMod: flags.installedMod === true,
      controllerUsed: flags.controllerUsed === true, bigPictureUsed: flags.bigPictureUsed === true,
    },
  };
}

/** The syncable slice of a local record. */
export function toSynced(local: LocalAchievements): SyncedAchievements {
  const { themes, views, usedDiscover, installedMod, controllerUsed, bigPictureUsed } = local.flags;
  return { unlocked: local.unlocked, flags: { themes, views, usedDiscover, installedMod, controllerUsed, bigPictureUsed } };
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** Union of both sides: an achievement is never lost, and the earliest unlock time wins. Order does not matter. */
export function mergeAchievements<T extends LocalAchievements>(local: T, cloud: SyncedAchievements): T {
  const unlocked = { ...cloud.unlocked };
  for (const [id, at] of Object.entries(local.unlocked)) unlocked[id] = id in unlocked ? Math.min(unlocked[id], at) : at;
  return {
    ...local,
    unlocked,
    flags: {
      ...local.flags,
      themes: union(local.flags.themes, cloud.flags.themes), views: union(local.flags.views, cloud.flags.views),
      usedDiscover: local.flags.usedDiscover || cloud.flags.usedDiscover, installedMod: local.flags.installedMod || cloud.flags.installedMod,
      controllerUsed: local.flags.controllerUsed || cloud.flags.controllerUsed, bigPictureUsed: local.flags.bigPictureUsed || cloud.flags.bigPictureUsed,
    },
  };
}

const canonical = (value: SyncedAchievements) => JSON.stringify({
  u: Object.entries(value.unlocked).sort(([a], [b]) => a.localeCompare(b)),
  t: [...value.flags.themes].sort(), v: [...value.flags.views].sort(),
  f: [value.flags.usedDiscover, value.flags.installedMod, value.flags.controllerUsed, value.flags.bigPictureUsed],
});
export const sameAchievements = (a: SyncedAchievements, b: SyncedAchievements) => canonical(a) === canonical(b);

/** The signed-in user's cloud copy, or null when none was saved yet. */
export async function pullAchievements(client: SupabaseClient, userId: string): Promise<SyncedAchievements | null> {
  const { data, error } = await client.from("achievements").select("data").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? sanitiseCloudAchievements(data.data) : null;
}

export async function pushAchievements(client: SupabaseClient, userId: string, value: SyncedAchievements) {
  const { error } = await client.from("achievements")
    .upsert({ user_id: userId, data: value, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function clearCloudAchievements(client: SupabaseClient, userId: string) {
  const { error } = await client.from("achievements").delete().eq("user_id", userId);
  if (error) throw error;
}
