import type { SupabaseClient } from "@supabase/supabase-js";
import type { Piko, Tofu } from "../models";

/**
 * Source ids the `pikos_source_id_check` constraint accepts (see 20261009150000_more_import_sources.sql).
 * Others are synced as null and the source filter falls back to the platform label.
 */
const CLOUD_SOURCE_IDS = new Set<string>(["flatpak", "heroic", "steam", "lutris", "bottles", "itch", "apps", "epic", "whisky", "battlenet", "gog", "prism"]);

const PIKO_COLUMNS = "local_id, name, description, accent, artwork, artwork_url, executable_path, source, source_id, platform_category, igdb_id, categories, screenshots, trailer_id, first_release_date, favorite, tags, artwork_source, kind";

type PikoRow = {
  local_id: string;
  name: string;
  description: string;
  accent: string;
  artwork: string | null;
  artwork_url: string | null;
  executable_path: string | null;
  source: "built-in" | "custom";
  source_id: Piko["sourceId"] | null;
  platform_category: string | null;
  igdb_id: number | null;
  categories: string[] | null;
  screenshots: string[] | null;
  trailer_id: string | null;
  first_release_date: number | null;
  favorite: boolean | null;
  tags: string[] | null;
  artwork_source: NonNullable<Piko["artworkSource"]> | null;
  kind: "game" | "launcher" | null;
  tofus: Array<{ local_id: string; name: string; version: string; runtime: string; mods_count: number; status: Tofu["status"] }> | null;
};

const defaultTofu = (): Tofu => ({ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" });

/** Reads the whole cloud library, Tofus included, in a single request. */
export async function pullLibrary(client: SupabaseClient, userId: string): Promise<Piko[]> {
  const { data, error } = await client
    .from("pikos")
    .select(`${PIKO_COLUMNS}, tofus(local_id, name, version, runtime, mods_count, status)`)
    .eq("user_id", userId)
    .order("created_at")
    .order("created_at", { referencedTable: "tofus" });
  if (error) throw error;

  return ((data ?? []) as unknown as PikoRow[]).map((piko) => ({
    id: piko.local_id,
    name: piko.name,
    description: piko.description,
    accent: piko.accent,
    artwork: piko.artwork ?? "",
    executablePath: piko.executable_path ?? undefined,
    source: piko.source,
    sourceId: piko.source_id ?? undefined,
    platformCategory: piko.platform_category ?? undefined,
    categories: piko.categories ?? [],
    igdbId: piko.igdb_id ?? undefined,
    artworkUrl: piko.artwork_url ?? undefined,
    screenshots: piko.screenshots ?? [],
    trailerId: piko.trailer_id ?? undefined,
    firstReleaseDate: piko.first_release_date ?? undefined,
    favorite: piko.favorite ?? false,
    tags: piko.tags ?? [],
    artworkSource: piko.artwork_source ?? undefined,
    kind: piko.kind ?? undefined,
    // The UI assumes every Piko has at least one Tofu, so never hand it an empty list.
    tofus: piko.tofus?.length
      ? piko.tofus.map((tofu) => ({ id: tofu.local_id, name: tofu.name, version: tofu.version, runtime: tofu.runtime, mods: tofu.mods_count, status: tofu.status }))
      : [defaultTofu()],
  }));
}

const clamp = (value: string | undefined, max: number) => (value && value.length > max ? value.slice(0, max) : value);

/** Replaces the cloud library with `library` in one transaction on the server. */
export async function pushLibrary(client: SupabaseClient, library: Piko[]) {
  const payload = library.map((piko) => ({
    local_id: piko.id,
    name: clamp(piko.name, 300),
    description: clamp(piko.description, 20000),
    accent: piko.accent,
    artwork: piko.artwork && piko.artwork.length <= 8192 ? piko.artwork : null,
    artwork_url: piko.artworkUrl ?? null,
    executable_path: clamp(piko.executablePath, 4096) ?? null,
    source: piko.source ?? "built-in",
    source_id: piko.sourceId && CLOUD_SOURCE_IDS.has(piko.sourceId) ? piko.sourceId : null,
    platform_category: piko.platformCategory ?? null,
    igdb_id: piko.igdbId ?? null,
    categories: (piko.categories ?? []).slice(0, 60),
    screenshots: (piko.screenshots ?? []).slice(0, 30),
    trailer_id: piko.trailerId ?? null,
    first_release_date: piko.firstReleaseDate ?? null,
    favorite: piko.favorite ?? false,
    tags: (piko.tags ?? []).slice(0, 60).map((tag) => tag.slice(0, 60)),
    // "icon" covers are drawn from a file on this device and the column does not allow the value.
    artwork_source: piko.artworkSource === "icon" ? null : piko.artworkSource ?? null,
    kind: piko.kind ?? null,
    tofus: (piko.tofus ?? []).map((tofu) => ({
      local_id: tofu.id, name: clamp(tofu.name, 200), version: clamp(tofu.version, 100), runtime: clamp(tofu.runtime, 100),
      mods_count: Number.isFinite(tofu.mods) ? Math.max(0, Math.floor(tofu.mods)) : 0, status: tofu.status,
    })),
  }));
  const { error } = await client.rpc("sync_my_library", { library: payload });
  if (error) throw error;
}

export type ClearedCloudData = {
  deleted_pikos: number;
  deleted_tofus: number;
};

export async function clearAccountCloudData(client: SupabaseClient): Promise<ClearedCloudData> {
  const { data, error } = await client.rpc("clear_my_cloud_data");
  if (error) throw error;
  return {
    deleted_pikos: Number(data?.deleted_pikos ?? 0),
    deleted_tofus: Number(data?.deleted_tofus ?? 0),
  };
}


export type CloudAccountSettings = { syncEnabled: boolean; metadataSyncAllowed: boolean };

export async function getCloudAccountSettings(client: SupabaseClient, userId: string): Promise<CloudAccountSettings> {
  const { data, error } = await client
    .from("profiles")
    .select("cloud_sync_enabled, metadata_sync_allowed")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { error: createError } = await client
      .from("profiles")
      .upsert({ id: userId, cloud_sync_enabled: false, metadata_sync_allowed: false }, { onConflict: "id" });
    if (createError) throw createError;
    return { syncEnabled: false, metadataSyncAllowed: false };
  }
  return {
    syncEnabled: data.cloud_sync_enabled === true,
    metadataSyncAllowed: data.metadata_sync_allowed === true,
  };
}

/**
 * Merges the cloud library into the local one. The cloud wins for the fields it stores, but local-only data
 * (install path, launch settings, collections, locked fields, cached artwork keys...) is kept, and games that
 * only exist on this device are not lost.
 */
export function mergeCloudLibrary(local: Piko[], cloud: Piko[]): Piko[] {
  const localById = new Map(local.map((piko) => [piko.id, piko]));
  const cloudIds = new Set(cloud.map((piko) => piko.id));
  const merged = cloud.map((remote) => {
    const mine = localById.get(remote.id);
    if (!mine) return remote;
    const tofuById = new Map(mine.tofus.map((tofu) => [tofu.id, tofu]));
    return {
      ...mine,
      ...remote,
      // Never replace artwork we have with an empty value (the cloud drops large inline images).
      artwork: remote.artwork || mine.artwork,
      artworkCacheKey: mine.artworkCacheKey,
      installPath: mine.installPath,
      collectionIds: mine.collectionIds,
      lockedFields: mine.lockedFields,
      modLinks: mine.modLinks,
      executablePath: remote.executablePath ?? mine.executablePath,
      tofus: remote.tofus.map((tofu) => ({ ...tofuById.get(tofu.id), ...tofu })),
    } satisfies Piko;
  });
  return [...merged, ...local.filter((piko) => !cloudIds.has(piko.id))];
}
