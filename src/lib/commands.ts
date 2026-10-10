import type { AppController } from "../state/AppContext";

/** What a command receives when it runs: a getter for the latest app controller (its identity changes every render). */
export type CommandContext = { app: () => AppController };

export type CommandGroup = "Navigate" | "Settings" | "Theme" | "Library" | "Mods" | "Help" | (string & {});

export type Command = {
  /** Stable id, used for recents. Namespace it ("nav.library", "mods.check"). */
  id: string;
  title: string;
  /** Extra words that should find the command. */
  keywords: string[];
  group: CommandGroup;
  run: (context: CommandContext) => void | Promise<void>;
  /** Hides the command when it cannot run right now (no Tofu selected, feature off, ...). */
  when?: (context: CommandContext) => boolean;
};

const commands = new Map<string, Command>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => { version += 1; listeners.forEach((listener) => listener()); };

/** Adds (or replaces) a command and returns a function that removes it again. Features call this from an effect. */
export function register(id: string, title: string, keywords: string[], group: CommandGroup, run: Command["run"], when?: Command["when"]): () => void {
  const command: Command = { id, title, keywords, group, run, when };
  commands.set(id, command);
  changed();
  return () => { if (commands.get(id) === command) { commands.delete(id); changed(); } };
}

export const getCommand = (id: string): Command | undefined => commands.get(id);

/** Commands that can run now, in registration order. */
export function listCommands(context: CommandContext): Command[] {
  return [...commands.values()].filter((command) => { try { return !command.when || command.when(context); } catch { return false; } });
}

/** Subscribe to registry changes (for `useSyncExternalStore`). */
export const subscribeCommands = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const commandsVersion = () => version;

/** Test helper: empties the registry. */
export function clearCommands() { commands.clear(); changed(); }
