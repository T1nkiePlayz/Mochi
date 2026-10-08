import type { SupabaseClient } from "@supabase/supabase-js";
import type { Piko, Tofu } from "../models";

type PikoRow = {
  id: string;
  local_id: string;
  name: string;
  description: string;
  accent: string;
  artwork: string | null;
  executable_path: string | null;
  source: "built-in" | "custom";
  categories: string[] | null;
  source_id: Piko["sourceId"] | null;
  platform_category: string | null;
  igdb_id: number | null;
  artwork_url: string | null;
  screenshots: string[] | null;
  trailer_id: string | null;
  first_release_date: number | null;
};

type TofuRow = {
  piko_id: string;
  local_id: string;
  name: string;
  version: string;
  runtime: string;
  mods_count: number;
  status: Tofu["status"];
};

export async function pullLibrary(client: SupabaseClient, userId: string): Promise<Piko[]> {
  const { data: pikoRows, error: pikoError } = await client
    .from("pikos")
    .select("id, local_id, name, description, accent, artwork, artwork_url, executable_path, source, source_id, platform_category, igdb_id, categories, screenshots, trailer_id, first_release_date")
    .eq("user_id", userId)
    .order("created_at");
  if (pikoError) throw pikoError;
  if (!pikoRows?.length) return [];

  const pikoIds = pikoRows.map((piko) => piko.id);
  const { data: tofuRows, error: tofuError } = await client
    .from("tofus")
    .select("piko_id, local_id, name, version, runtime, mods_count, status")
    .in("piko_id", pikoIds)
    .order("created_at");
  if (tofuError) throw tofuError;

  const tofusByPiko = new Map<string, Tofu[]>();
  for (const tofu of (tofuRows ?? []) as TofuRow[]) {
    const current = tofusByPiko.get(tofu.piko_id) ?? [];
    current.push({
      id: tofu.local_id,
      name: tofu.name,
      version: tofu.version,
      runtime: tofu.runtime,
      mods: tofu.mods_count,
      status: tofu.status,
    });
    tofusByPiko.set(tofu.piko_id, current);
  }

  return (pikoRows as PikoRow[]).map((piko) => ({
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
    // The UI assumes every Piko has at least one Tofu, so never hand it an empty list.
    tofus: tofusByPiko.get(piko.id) ?? [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" as const }],
  }));
}

export async function pushLibrary(client: SupabaseClient, userId: string, library: Piko[]) {
  if (!library.length) {
    const { error } = await client.from("pikos").delete().eq("user_id", userId);
    if (error) throw error;
    return;
  }

  const { data: pikoRows, error: pikoError } = await client
    .from("pikos")
    .upsert(
      library.map((piko) => ({
        user_id: userId,
        local_id: piko.id,
        name: piko.name,
        description: piko.description,
        accent: piko.accent,
        artwork: piko.artwork,
        artwork_url: piko.artworkUrl ?? null,
        executable_path: piko.executablePath ?? null,
        source: piko.source ?? "built-in",
        source_id: piko.sourceId ?? null,
        platform_category: piko.platformCategory ?? null,
        igdb_id: piko.igdbId ?? null,
        categories: piko.categories ?? [],
        screenshots: piko.screenshots ?? [],
        trailer_id: piko.trailerId ?? null,
        first_release_date: piko.firstReleaseDate ?? null,
      })),
      { onConflict: "user_id,local_id" },
    )
    .select("id, local_id");
  if (pikoError) throw pikoError;

  const cloudIds = new Map((pikoRows ?? []).map((piko) => [piko.local_id, piko.id]));
  const tofuRows = library.flatMap((piko) =>
    piko.tofus.map((tofu) => ({
      piko_id: cloudIds.get(piko.id),
      local_id: tofu.id,
      name: tofu.name,
      version: tofu.version,
      runtime: tofu.runtime,
      mods_count: tofu.mods,
      status: tofu.status,
    })),
  );
  const { error: deletePikosError } = await client
    .from("pikos")
    .delete()
    .eq("user_id", userId)
    .not("local_id", "in", `(${library.map((piko) => `"${piko.id.replace(/"/g, '""')}"`).join(",") || '""'})`);
  if (deletePikosError) throw deletePikosError;

  // Stale Tofus are removed even when no Tofus remain locally, otherwise deleting
  // the last one would leave it behind in the cloud forever.
  for (const piko of library) {
    const cloudPikoId = cloudIds.get(piko.id);
    if (!cloudPikoId) continue;
    const localIds = piko.tofus.map((tofu) => tofu.id);
    const { error: staleTofusError } = await client
      .from("tofus")
      .delete()
      .eq("piko_id", cloudPikoId)
      .not("local_id", "in", `(${localIds.map((id) => `"${id.replace(/"/g, '""')}"`).join(",") || '""'})`);
    if (staleTofusError) throw staleTofusError;
  }

  if (!tofuRows.length) return;
  const { error: tofuError } = await client
    .from("tofus")
    .upsert(tofuRows, { onConflict: "piko_id,local_id" });
  if (tofuError) throw tofuError;
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
