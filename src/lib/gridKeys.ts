// Keyboard model for the library grid: pure (no DOM), so the key rules are tested without rendering anything.
// Controllers reach the same cards through controller/spatial; this is the keyboard-first layer on top.

export type KeyLike = { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };

export type GridAction =
  | { type: "step"; delta: -1 | 1 }
  | { type: "row"; direction: "up" | "down" }
  | { type: "edge"; edge: "first" | "last" }
  | { type: "page"; direction: "up" | "down" }
  | { type: "play" }
  | { type: "favorite" }
  | { type: "search" }
  | { type: "type"; char: string };

/** What a key press on a game card means, or `null` to leave it to the browser. */
export function gridKeyAction(event: KeyLike): GridAction | null {
  const command = Boolean(event.ctrlKey || event.metaKey);
  if (event.altKey) return null;
  switch (event.key) {
    case "ArrowLeft": return command || event.shiftKey ? null : { type: "step", delta: -1 };
    case "ArrowRight": return command || event.shiftKey ? null : { type: "step", delta: 1 };
    case "ArrowUp": return command || event.shiftKey ? null : { type: "row", direction: "up" };
    case "ArrowDown": return command || event.shiftKey ? null : { type: "row", direction: "down" };
    case "Home": return { type: "edge", edge: "first" };
    case "End": return { type: "edge", edge: "last" };
    case "PageUp": return { type: "page", direction: "up" };
    case "PageDown": return { type: "page", direction: "down" };
    case "Enter": return event.shiftKey && !command ? { type: "play" } : null;
    case "/": return command ? null : { type: "search" };
    default:
      if (command && event.key.toLowerCase() === "d") return { type: "favorite" };
      return !command && event.key.length === 1 && /\S/.test(event.key) ? { type: "type", char: event.key } : null;
  }
}

export const TYPE_AHEAD_MS = 700;

/** Collects typed letters into a search prefix that resets after a pause. */
export function createTypeAhead(timeoutMs = TYPE_AHEAD_MS) {
  let buffer = "";
  let last = 0;
  return (char: string, now: number): string => {
    if (now - last > timeoutMs) buffer = "";
    last = now;
    buffer += char.toLowerCase();
    return buffer;
  };
}

/**
 * The next name that starts with `prefix`, searching after `from` and wrapping. Typing the same letter repeatedly
 * cycles through the names starting with it (like a file manager). -1 when nothing matches.
 */
export function prefixMatch(names: readonly string[], from: number, prefix: string): number {
  if (!prefix || !names.length) return -1;
  const lower = names.map((name) => name.trim().toLowerCase());
  const repeated = prefix.length > 1 && [...prefix].every((char) => char === prefix[0]);
  const needle = repeated ? prefix[0] : prefix;
  // A growing prefix may keep the current game when it still matches; a repeated letter moves on.
  const start = repeated || prefix.length === 1 ? from + 1 : Math.max(from, 0);
  for (let step = 0; step < lower.length; step += 1) {
    const index = (((start + step) % lower.length) + lower.length) % lower.length;
    if (lower[index].startsWith(needle)) return index;
  }
  return -1;
}

/** How many rows a Page Up / Page Down press moves: about one screen, keeping one row of context. */
export const pageRows = (viewportHeight: number, rowHeight: number): number => (rowHeight > 0 ? Math.max(1, Math.floor(viewportHeight / rowHeight) - 1) : 1);
