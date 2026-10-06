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
    .select("id, local_id, name, description, accent, artwork, executable_path, source")
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
    tofus: tofusByPiko.get(piko.id) ?? [],
  }));
}

export async function pushLibrary(client: SupabaseClient, userId: string, library: Piko[]) {
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
        executable_path: piko.executablePath ?? null,
        source: piko.source ?? "built-in",
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
  if (!tofuRows.length) return;

  const { error: tofuError } = await client
    .from("tofus")
    .upsert(tofuRows, { onConflict: "piko_id,local_id" });
  if (tofuError) throw tofuError;
}
