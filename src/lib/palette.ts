import type { Piko } from "../models";
import type { Command } from "./commands";
import { foldText, fuzzyScore, queryTokens } from "./fuzzy";
import { readJson, writeJson } from "./storage";

export const PALETTE_LIMIT = 50;
export const RECENT_LIMIT = 8;
export const RECENTS_KEY = "mochi:palette-recents";
export const OPEN_PALETTE_EVENT = "mochi:open-palette";

/** Opens the command palette (Ctrl/Cmd+K, the shortcuts list, features). */
export const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));

/** "⌘K" on macOS, "Ctrl K" elsewhere. */
export const paletteShortcutLabel = (platform?: string) => {
  const mac = platform ? platform === "macos" : typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || "");
  return mac ? "⌘K" : "Ctrl K";
};

export type ParsedQuery = { mode: "all" | "actions"; text: string };

/** A leading ">" limits the palette to actions; everything else searches games and actions. */
export function parsePaletteQuery(raw: string): ParsedQuery {
  const trimmed = raw.trimStart();
  return trimmed.startsWith(">") ? { mode: "actions", text: trimmed.slice(1).trim() } : { mode: "all", text: raw.trim() };
}

/** "install <name>" / "mod <name>": the mod name to search for in Discover, or null. */
export function installQuery(text: string): string | null {
  const match = /^(?:install|mod|mods)\s+(.+)$/i.exec(text.trim());
  return match ? match[1]!.trim() : null;
}

// --- recents -----------------------------------------------------------------------------------------------------

export const readRecents = (): string[] => {
  const stored = readJson<unknown>(RECENTS_KEY, []);
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string").slice(0, RECENT_LIMIT) : [];
};
/** Pure update: moves `id` to the front, dedupes, keeps the last 8. */
export const pushRecent = (recents: readonly string[], id: string): string[] => [id, ...recents.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
export const rememberAction = (id: string) => writeJson(RECENTS_KEY, pushRecent(readRecents(), id));

// --- ranking -----------------------------------------------------------------------------------------------------

export type PaletteItem =
  | { kind: "command"; key: string; title: string; subtitle: string; command: Command; score: number }
  | { kind: "game"; key: string; title: string; subtitle: string; piko: Piko; score: number }
  | { kind: "tofu"; key: string; title: string; subtitle: string; piko: Piko; tofuId: string; score: number };

/** Actions shown first when the box is empty, in this order, after recents. */
export const TOP_ACTION_IDS = ["nav.library", "nav.discover", "nav.installed", "nav.downloads", "nav.stats", "nav.settings", "library.add", "library.import", "mods.check", "bigpicture.toggle", "help.shortcuts", "help.docs"];

const foldCache = new WeakMap<object, string>();
const titleCache = new WeakMap<object, string>();
const folded = (cache: WeakMap<object, string>, owner: Piko | Command, build: () => string) => { let value = cache.get(owner); if (value === undefined) { value = foldText(build()); cache.set(owner, value); } return value; };
const gameText = (piko: Piko) => folded(foldCache, piko, () => piko.name);
const commandText = (command: Command) => folded(foldCache, command, () => `${command.title} ${command.keywords.join(" ")}`);
const commandTitle = (command: Command) => folded(titleCache, command, () => command.title);

/** Command title matches count more than keyword-only matches. */
const commandScore = (tokens: string[], command: Command) => {
  const title = fuzzyScore(tokens, commandTitle(command));
  if (title >= 0) return title + 200;
  return fuzzyScore(tokens, commandText(command));
};

export type RankInput = { raw: string; commands: readonly Command[]; games: readonly Piko[]; recents?: readonly string[]; tofus?: boolean };

/** Ranks games and commands for the palette, capped at `PALETTE_LIMIT`. */
export function rankPalette({ raw, commands, games, recents = [], tofus = true }: RankInput): PaletteItem[] {
  const { mode, text } = parsePaletteQuery(raw);
  const asCommand = (command: Command, score: number): PaletteItem => ({ kind: "command", key: `c:${command.id}`, title: command.title, subtitle: command.group, command, score });
  if (!text) {
    const byId = new Map(commands.map((command) => [command.id, command]));
    const seen = new Set<string>();
    const out: PaletteItem[] = [];
    for (const id of [...recents, ...(mode === "actions" ? commands.map((command) => command.id) : TOP_ACTION_IDS)]) {
      const command = byId.get(id);
      if (!command || seen.has(id)) continue;
      seen.add(id);
      out.push({ ...asCommand(command, 0), subtitle: recents.includes(id) ? `Recent · ${command.group}` : command.group });
      if (out.length >= PALETTE_LIMIT) break;
    }
    return out;
  }
  const tokens = queryTokens(text);
  const recentBonus = (id: string) => { const at = recents.indexOf(id); return at < 0 ? 0 : 60 - at * 5; };
  const out: PaletteItem[] = [];
  const install = installQuery(text);
  if (install) out.push({ kind: "command", key: "c:mods.install-query", title: `Install mod "${install}"`, subtitle: "Opens Discover with this search", score: 1e9, command: installFromQuery(install) });
  for (const command of commands) {
    const score = commandScore(tokens, command);
    if (score >= 0) out.push(asCommand(command, score + recentBonus(command.id)));
  }
  if (mode === "all") {
    for (const piko of games) {
      const score = fuzzyScore(tokens, gameText(piko));
      if (score >= 0) out.push({ kind: "game", key: `g:${piko.id}`, title: piko.name, subtitle: "Game", piko, score });
    }
  }
  if (tofus) {
    for (const piko of games) for (const tofu of piko.tofus ?? []) {
      const score = fuzzyScore(tokens, foldText(`${piko.name} ${tofu.name}`));
      if (score >= 0) out.push({ kind: "tofu", key: `t:${tofu.id}`, title: `${piko.name} · ${tofu.name}`, subtitle: "Open Tofu", piko, tofuId: tofu.id, score: score - 50 });
    }
  }
  return topN(out, PALETTE_LIMIT);
}

/** The best `limit` items by score without sorting the whole list when it is long. */
export function topN(items: PaletteItem[], limit: number): PaletteItem[] {
  const sorted = items.length > limit * 4 ? partialTop(items, limit) : items;
  return [...sorted].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
function partialTop(items: PaletteItem[], limit: number): PaletteItem[] {
  const scores = items.map((item) => item.score).sort((a, b) => b - a);
  const cut = scores[limit - 1] ?? -Infinity;
  return items.filter((item) => item.score >= cut);
}

/** Opens Discover with the mod name prefilled. Kept here so the palette can build it without a registry entry. */
function installFromQuery(name: string): Command {
  return { id: "mods.install-query", title: `Install mod "${name}"`, keywords: [], group: "Mods", run: async ({ app }) => { const { openDiscoverWithQuery } = await import("./discoverQuery"); openDiscoverWithQuery(name, app().setActiveNav); } };
}
