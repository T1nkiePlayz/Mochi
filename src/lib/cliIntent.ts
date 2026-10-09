/** `mochi launch <game>`, `mochi open <game>` and the matching `mochi://` links. Mirrors src-tauri/src/cli.rs. */
export type CliIntent = { kind: "launch" | "open"; query: string };
export type GameRef = { id: string; name: string };
export type Resolution<T extends GameRef> = { status: "none" } | { status: "one"; game: T } | { status: "many"; matches: T[] };

export const MAX_QUERY_CHARS = 200;
export const MAX_MATCHES = 12;

/** Trimmed, non-empty, bounded, no control characters; anything else is not a usable query. */
export function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const query = raw.trim();
  if (!query || [...query].length > MAX_QUERY_CHARS || /[\u0000-\u001f\u007f-\u009f]/.test(query)) return null;
  return query;
}

/** Only `mochi://launch/<x>` and `mochi://open/<x>`; every other verb (and any bad query) is ignored. */
export function parseCliUrl(url: string): CliIntent | null {
  const match = /^mochi:\/\/(launch|open)\/([^?#]*)/i.exec(url.trim());
  if (!match) return null;
  let decoded: string;
  try { decoded = decodeURIComponent((match[2] ?? "").replace(/\/+$/, "")); } catch { return null; }
  const query = cleanQuery(decoded);
  return query ? { kind: match[1]!.toLowerCase() as CliIntent["kind"], query } : null;
}

/** Validates an event or boot payload from the native side. */
export function parseCliPayload(payload: unknown): CliIntent | null {
  if (!payload || typeof payload !== "object") return null;
  const { kind, query } = payload as { kind?: unknown; query?: unknown };
  const clean = cleanQuery(query);
  return (kind === "launch" || kind === "open") && clean ? { kind, query: clean } : null;
}

/** Exact id, then exact name (ignoring case), then names starting with the query, then names containing it; the first step with a hit decides. */
export function resolveGame<T extends GameRef>(library: readonly T[], rawQuery: string): Resolution<T> {
  const query = rawQuery.trim();
  const needle = query.toLowerCase();
  if (!needle) return { status: "none" };
  const steps: Array<(game: T) => boolean> = [
    (game) => game.id === query,
    (game) => game.name.trim().toLowerCase() === needle,
    (game) => game.name.toLowerCase().startsWith(needle),
    (game) => game.name.toLowerCase().includes(needle),
  ];
  for (const step of steps) {
    const hits = library.filter(step);
    if (hits.length === 1) return { status: "one", game: hits[0]! };
    if (hits.length > 1) return { status: "many", matches: hits.slice(0, MAX_MATCHES) };
  }
  return { status: "none" };
}
