import type { Piko } from "../models";
import type { ImportedGame } from "./sources";

export type WatchDiff = { added: ImportedGame[]; missing: Piko[] };

/**
 * Compares what the import sources report now with the library. `added` are installed games the library does not have;
 * `missing` are library games imported from a source whose scan no longer lists them. A source whose scan came back
 * empty is never used to call games missing (a launcher that is merely not ready would flag everything).
 */
export function diffLibrary(library: Piko[], scans: ReadonlyMap<string, ImportedGame[]>): WatchDiff {
  const haveKey = new Set<string>(), haveTarget = new Set<string>();
  for (const piko of library) {
    if (piko.importKey) haveKey.add(piko.importKey);
    if (piko.executablePath) haveTarget.add(piko.executablePath);
    for (const source of piko.launchSources ?? []) haveTarget.add(source.executablePath);
  }
  const added: ImportedGame[] = [];
  for (const games of scans.values()) {
    for (const game of games) if (game.kind !== "launcher" && !game.contentType && !haveKey.has(game.id) && !haveTarget.has(game.launchTarget)) added.push(game);
  }
  const missing = library.filter((piko) => {
    const scan = piko.sourceId ? scans.get(piko.sourceId) : undefined;
    return Boolean(piko.importKey && scan?.length && !scan.some((game) => game.id === piko.importKey));
  });
  return { added, missing };
}

/** Splits `ids` into those not seen before. The first ever check (`known === null`) only records what exists, so nothing floods. */
export function unseen(ids: string[], known: ReadonlySet<string> | null): string[] {
  return known === null ? [] : ids.filter((id) => !known.has(id));
}

export function describeWatch(added: number, missing: number): { title: string; message: string } | null {
  if (!added && !missing) return null;
  const parts = [
    added ? `${added} new game${added === 1 ? "" : "s"} found (Add game > Import)` : "",
    missing ? `${missing} game${missing === 1 ? "" : "s"} no longer found in their launcher` : "",
  ].filter(Boolean);
  return { title: "Library changes", message: `${parts.join(" and ")}.` };
}
