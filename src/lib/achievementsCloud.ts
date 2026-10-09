import type { SupabaseClient } from "@supabase/supabase-js";
import type { AchievementFlags } from "./achievementTypes";

/**
 * Cloud copy of a user's Mochi achievements: one row per user in `public.achievements` (RLS: own row only).
 * Only unlocks and the recorded flags travel; Steam totals are per device and rebuilt locally.
 */
export type AchievementCloudData = { version: 1; unlocked: Record<string, number>; flags: Omit<AchievementFlags, "steam"> };
type Mergeable = { unlocked: Record<string, number>; flags: AchievementFlags };

const MAX_IDS = 2000;
const MAX_LIST = 200;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= 100).slice(0, MAX_LIST) : [];
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Accepts whatever is stored in the row (written by any client version) and returns only well-formed data. */
export function sanitizeCloudAchievements(raw: unknown): AchievementCloudData {
  const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const unlocked: Record<string, number> = {};
  if (data.unlocked && typeof data.unlocked === "object") {
    for (const [id, at] of Object.entries(data.unlocked as Record<string, unknown>).slice(0, MAX_IDS)) if (id.length <= 100 && validTime(at)) unlocked[id] = at;
  }
  const flags = (data.flags && typeof data.flags === "object" ? data.flags : {}) as Record<string, unknown>;
  return {
    version: 1,
    unlocked,
    flags: {
      themes: strings(flags.themes), views: strings(flags.views),
      usedDiscover: flags.usedDiscover === true, installedMod: flags.installedMod === true,
      controllerUsed: flags.controllerUsed === true, bigPictureUsed: flags.bigPictureUsed === true,
    },
  };
}

export function toCloudAchievements(local: Mergeable): AchievementCloudData {
  const { steam: _steam, ...flags } = local.flags;
  return sanitizeCloudAchievements({ unlocked: local.unlocked, flags });
}

/** Union of unlocks keeping the earliest unlock time; flags are OR-ed and lists unioned. Local Steam totals are kept. */
export function mergeAchievements<T extends Mergeable>(local: T, cloud: AchievementCloudData): T {
  const unlocked: Record<string, number> = { ...local.unlocked };
  for (const [id, at] of Object.entries(cloud.unlocked)) unlocked[id] = id in unlocked && validTime(unlocked[id]) ? Math.min(unlocked[id], at) : at;
  const a = local.flags, b = cloud.flags;
  return {
    ...local,
    unlocked,
    flags: {
      ...a,
      themes: union(a.themes, b.themes), views: union(a.views, b.views),
      usedDiscover: a.usedDiscover || b.usedDiscover, installedMod: a.installedMod || b.installedMod,
      controllerUsed: a.controllerUsed || b.controllerUsed, bigPictureUsed: a.bigPictureUsed || b.bigPictureUsed,
    },
  };
}

export async function pullCloudAchievements(client: SupabaseClient, userId: string): Promise<AchievementCloudData | null> {
  const { data, error } = await client.from("achievements").select("data").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? sanitizeCloudAchievements((data as { data: unknown }).data) : null;
}

export async function pushCloudAchievements(client: SupabaseClient, userId: string, data: AchievementCloudData): Promise<void> {
  const { error } = await client.from("achievements").upsert({ user_id: userId, data, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function deleteCloudAchievements(client: SupabaseClient, userId: string): Promise<void> {
  const { error } = await client.from("achievements").delete().eq("user_id", userId);
  if (error) throw error;
}
