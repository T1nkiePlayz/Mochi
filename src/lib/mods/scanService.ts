import { cfFingerprints, cfModNames, CF_MINECRAFT_ID } from "../curseforge";
import { nexusMd5Search } from "../nexus";
import { isOnline } from "../offline";
import { supabase } from "../supabase";
import type { Piko, Tofu } from "../../models";
import { modSupportOf } from "./gameSupport";
import { identifyFiles, titleFromFile, type IdentifyDeps } from "./identify";
import { hashModFiles, listInstanceMods, modrinthIdentify, recordInstanceMods, type InstanceMod, type RecordEntry } from "./instances";
import type { ModSourceSettings } from "./resolveSources";
import type { Subdir } from "./targets";

export type ScanResult = { files: number; /** Files in the main mods folder (the Tofu's mod count). */ modFiles: number; identified: number; unidentified: number; notes: string[]; /** False when the sites could not be asked (offline). */ online: boolean };

/** A file Mochi knows nothing useful about yet: no record, or a manual one without a linked project. */
export const needsIdentification = (file: InstanceMod) => !file.foreign && (!file.record || (file.record.source === "manual" && !file.record.projectId));

/** The site lookups that apply to this game, given the user's switches and keys. */
export function identifyDepsFor(piko: Piko, sources: ModSourceSettings, nexusKey: boolean): IdentifyDeps {
  const minecraft = modSupportOf(piko) === "minecraft";
  const cfGameId = minecraft ? CF_MINECRAFT_ID : piko.modLinks?.curseforge?.gameId;
  const nexusDomain = piko.modLinks?.nexus?.domain;
  const client = supabase;
  return {
    ...(minecraft && sources.modrinth ? { modrinth: modrinthIdentify } : {}),
    ...(sources.curseforge && client ? { curseforge: (prints: number[]) => cfFingerprints(prints, cfGameId), curseforgeNames: cfModNames } : {}),
    ...(sources.nexus && nexusKey && nexusDomain && client ? { nexus: (md5s: string[]) => nexusMd5Search(client, nexusDomain, md5s) } : {}),
  };
}

/**
 * Reads a Tofu's mod folder (and Minecraft content folders), identifies files Mochi has no provenance for and records every
 * file in the Tofu: identified ones with their site, project, file and date (so updates and "Downloaded" work), the rest as
 * manual entries the user can link by hand. Never throws for site failures; they come back as notes.
 */
export async function scanTofuMods(piko: Piko, tofu: Tofu, sources: ModSourceSettings, nexusKey: boolean): Promise<ScanResult> {
  const result: ScanResult = { files: 0, modFiles: 0, identified: 0, unidentified: 0, notes: [], online: isOnline() };
  if (!tofu.path) return result;
  const siblings = piko.tofus.map((other) => other.id);
  const lanes: Array<Subdir | undefined> = [undefined, ...(tofu.contentRoot ? (["resourcepacks", "shaderpacks"] as Subdir[]) : [])];
  const pending: Array<{ file: InstanceMod; subdir: string }> = [];
  for (const subdir of lanes) {
    const base = subdir && tofu.contentRoot && tofu.path === tofu.gameDir ? tofu.contentRoot : tofu.path;
    const files = await listInstanceMods(tofu.id, base, subdir, siblings).catch(() => null);
    if (!files) continue;
    result.files += files.length;
    if (!subdir) result.modFiles = files.filter((file) => !file.foreign).length;
    for (const file of files) if (needsIdentification(file)) pending.push({ file, subdir: subdir ?? "" });
  }
  if (!pending.length) return result;

  const hashes = await hashModFiles(pending.map((entry) => entry.file.path)).catch(() => []);
  const byPath = new Map(hashes.map((hash) => [hash.path, hash]));
  const found = result.online ? await identifyFiles(hashes, identifyDepsFor(piko, sources, nexusKey)) : { found: new Map(), notes: [] };
  result.notes.push(...found.notes);

  const entries: RecordEntry[] = pending.map(({ file, subdir }) => {
    const hit = found.found.get(file.path);
    if (hit) result.identified += 1; else result.unidentified += 1;
    const name = file.filename.replace(/\.disabled$/, "");
    return {
      file: name, subdir, sha1: byPath.get(file.path)?.sha1, enabled: file.enabled,
      record: hit ?? { source: "manual", projectId: "", fileId: "", title: titleFromFile(name) },
    };
  });
  await recordInstanceMods(tofu.id, entries);
  return result;
}
