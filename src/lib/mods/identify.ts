// Identifies mod files that are already installed: Modrinth by SHA-1, CurseForge by fingerprint, Nexus Mods by MD5.
// No runtime imports: the network calls are passed in (`IdentifyDeps`), so this is unit tested without Tauri or a server.

/** What the native hasher returns for one file (`hash_mod_files`). */
export type FileHashes = { path: string; filename: string; size: number; sha1: string; md5: string; fingerprint: number };

/** Provenance found for a file; `fileDate` makes CurseForge and Nexus update checks possible. */
export type FoundRecord = { source: "modrinth" | "curseforge" | "nexus"; projectId: string; fileId: string; version?: string; title: string; iconUrl?: string; fileDate?: string };

export type CfMatch = { id: number; file: { id: number; modId?: number; displayName?: string; fileName?: string; fileDate?: string; fileFingerprint?: number } };
export type NexusMatch = { md5: string; modId: number; fileId: number; name: string; version: string; fileName: string; uploadedAt: number };
export type ModrinthHit = { projectId: string; versionId: string; versionNumber: string; title: string; iconUrl?: string; datePublished: string };

export type IdentifyDeps = {
  modrinth?: (sha1s: string[]) => Promise<Record<string, ModrinthHit>>;
  curseforge?: (fingerprints: number[]) => Promise<CfMatch[]>;
  /** Names of CurseForge mods by id (the fingerprint answer only has file names). */
  curseforgeNames?: (modIds: number[]) => Promise<Map<number, string>>;
  nexus?: (md5s: string[]) => Promise<NexusMatch[]>;
};

export type IdentifyResult = { found: Map<string, FoundRecord>; notes: string[] };

const errorText = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "lookup failed");

/** A readable title from a file name when a site only gives file data: "jei-1.20.1-15.2.0.jar" -> "jei". */
export function titleFromFile(fileName: string): string {
  const base = fileName.replace(/\.disabled$/i, "").replace(/\.[a-z0-9]{1,6}$/i, "");
  const words = base.split(/[-_ ]+/).filter(Boolean);
  const kept: string[] = [];
  for (const word of words) { if (/^v?\d/.test(word) || /^(mc|fabric|forge|neoforge|quilt)\d/i.test(word)) break; kept.push(word); }
  return (kept.length ? kept : words).join(" ").trim() || fileName;
}

/** CurseForge fingerprint answers matched back to the files. */
export function matchCurseforge(files: readonly FileHashes[], matches: readonly CfMatch[], names: ReadonlyMap<number, string>): Map<string, FoundRecord> {
  const byPrint = new Map<number, CfMatch>();
  for (const match of matches) if (typeof match.file?.fileFingerprint === "number") byPrint.set(match.file.fileFingerprint, match);
  const out = new Map<string, FoundRecord>();
  for (const file of files) {
    const match = byPrint.get(file.fingerprint);
    if (!match) continue;
    const modId = match.id || match.file.modId || 0;
    out.set(file.path, {
      source: "curseforge", projectId: String(modId), fileId: String(match.file.id), version: match.file.displayName || match.file.fileName,
      title: names.get(modId) || titleFromFile(match.file.fileName || file.filename), fileDate: match.file.fileDate,
    });
  }
  return out;
}

export function matchNexus(files: readonly FileHashes[], matches: readonly NexusMatch[]): Map<string, FoundRecord> {
  const byMd5 = new Map(matches.map((match) => [match.md5.toLowerCase(), match]));
  const out = new Map<string, FoundRecord>();
  for (const file of files) {
    const match = byMd5.get(file.md5.toLowerCase());
    if (!match) continue;
    out.set(file.path, {
      source: "nexus", projectId: String(match.modId), fileId: String(match.fileId), version: match.version || undefined, title: match.name || titleFromFile(file.filename),
      fileDate: match.uploadedAt ? new Date(match.uploadedAt * 1000).toISOString() : undefined,
    });
  }
  return out;
}

export function matchModrinth(files: readonly FileHashes[], hits: Readonly<Record<string, ModrinthHit>>): Map<string, FoundRecord> {
  const out = new Map<string, FoundRecord>();
  for (const file of files) {
    const hit = hits[file.sha1.toLowerCase()];
    if (!hit) continue;
    out.set(file.path, { source: "modrinth", projectId: hit.projectId, fileId: hit.versionId, version: hit.versionNumber, title: hit.title, iconUrl: hit.iconUrl, fileDate: hit.datePublished || undefined });
  }
  return out;
}

/**
 * Looks the files up site by site (Modrinth, then CurseForge, then Nexus Mods), each site only for what the previous ones
 * did not know. A failing site becomes a note; it never stops the others. The caller decides which sites to pass in.
 */
export async function identifyFiles(files: readonly FileHashes[], deps: IdentifyDeps): Promise<IdentifyResult> {
  const found = new Map<string, FoundRecord>();
  const notes: string[] = [];
  const left = () => files.filter((file) => !found.has(file.path));
  const absorb = (next: Map<string, FoundRecord>) => next.forEach((record, path) => { if (!found.has(path)) found.set(path, record); });

  if (deps.modrinth && left().length) {
    try { absorb(matchModrinth(left(), await deps.modrinth(left().map((file) => file.sha1)))); }
    catch (error) { notes.push(`Modrinth: ${errorText(error)}`); }
  }
  if (deps.curseforge && left().length) {
    try {
      const pending = left();
      const matches = await deps.curseforge(pending.map((file) => file.fingerprint));
      let names = new Map<number, string>();
      if (matches.length && deps.curseforgeNames) {
        try { names = await deps.curseforgeNames(matches.map((match) => match.id).filter(Boolean)); } catch { /* titles fall back to file names */ }
      }
      absorb(matchCurseforge(pending, matches, names));
    } catch (error) { notes.push(`CurseForge: ${errorText(error)}`); }
  }
  if (deps.nexus && left().length) {
    try { const pending = left(); absorb(matchNexus(pending, await deps.nexus(pending.map((file) => file.md5)))); }
    catch (error) { notes.push(`Nexus Mods: ${errorText(error)}`); }
  }
  return { found, notes };
}
