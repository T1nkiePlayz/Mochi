// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.

/** The file to offer first: newest stable release, else newest beta, else newest of anything. */
export function pickBestFile<T extends { releaseType?: number; fileDate?: string }>(files: readonly T[]): T | undefined {
  const time = (file: T) => (file.fileDate ? Date.parse(file.fileDate) || 0 : 0);
  const rank = (file: T) => (file.releaseType === 1 ? 0 : file.releaseType === 2 ? 1 : 2);
  return [...files].sort((a, b) => rank(a) - rank(b) || time(b) - time(a))[0];
}

export const RESTRICTED_MESSAGE = "The author disabled downloads outside CurseForge.";

/** Why a CurseForge file cannot be downloaded by Mochi, or null when it can. Never builds a URL itself. */
export function restrictedReason(mod: { allowModDistribution?: boolean | null }, file: { downloadUrl?: string | null }): string | null {
  if (mod.allowModDistribution === false) return RESTRICTED_MESSAGE;
  if (!file.downloadUrl) return RESTRICTED_MESSAGE;
  return null;
}

const squash = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

/** Alternate between two lists, dropping an item whose name an earlier item already used. */
export function interleaveUnique<T>(first: readonly T[], second: readonly T[], nameOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (item: T | undefined) => {
    if (item === undefined) return;
    const key = squash(nameOf(item));
    if (key && seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) { add(first[index]); add(second[index]); }
  return out;
}

export type NxmLink = { gameDomain: string; modId: number; fileId: number; key: string; expires: number };

/** Parse `nxm://<game>/mods/<id>/files/<fid>?key=&expires=`. Returns null for anything that is not exactly that shape. */
export function parseNxmUrl(value: string): NxmLink | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "nxm:") return null;
  const gameDomain = url.hostname.toLowerCase();
  const path = /^\/mods\/(\d{1,9})\/files\/(\d{1,9})\/?$/.exec(url.pathname);
  const key = url.searchParams.get("key") ?? "";
  const expires = Number(url.searchParams.get("expires"));
  if (!/^[a-z0-9_-]{1,64}$/.test(gameDomain) || !path) return null;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(key) || !Number.isSafeInteger(expires) || expires <= 0) return null;
  const modId = Number(path[1]);
  const fileId = Number(path[2]);
  if (modId < 1 || fileId < 1) return null;
  return { gameDomain, modId, fileId, key, expires };
}

export function nxmFromUrl(urls: readonly string[]): NxmLink | null {
  for (const url of urls) { const link = parseNxmUrl(url); if (link) return link; }
  return null;
}
