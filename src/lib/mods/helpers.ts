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
