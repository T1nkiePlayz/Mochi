import type { LaunchOptions } from "../models";
import { defaultLaunchOptions, hasLaunchOptions, parseArgs } from "./launch";

/** Applies a change to a game's launch options; an untouched set is stored as nothing. */
export function updateLaunchOptions(current: LaunchOptions | undefined, changes: Partial<LaunchOptions>): LaunchOptions | undefined {
  const next: LaunchOptions = { ...(current ?? defaultLaunchOptions()), ...changes };
  if (next.runtime?.kind === "native") delete next.runtime;
  if (next.workingDir === "") delete next.workingDir;
  if (next.gamescope && !next.gamescope.enabled && next.gamescope.args.length === 0) delete next.gamescope;
  if (!next.gamemode) delete next.gamemode;
  if (!next.mangohud) delete next.mangohud;
  return hasLaunchOptions(next) ? next : undefined;
}

export const setEnvRow = (env: LaunchOptions["env"], index: number, row: [string, string]): LaunchOptions["env"] => env.map((item, at) => at === index ? row : item);
export const removeEnvRow = (env: LaunchOptions["env"], index: number): LaunchOptions["env"] => env.filter((_, at) => at !== index);
export const addEnvRow = (env: LaunchOptions["env"]): LaunchOptions["env"] => [...env, ["", ""]];

/** Inline message for one variable name, matching the launcher's rule. */
export function envNameError(key: string): string | null {
  const name = key.trim();
  if (!name) return null;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? null : "Use letters, digits and underscores, not starting with a digit.";
}

/** Names used more than once (the last row wins). */
export const duplicateEnvNames = (env: LaunchOptions["env"]): Set<string> => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const [key] of env) { const name = key.trim(); if (!name) continue; if (seen.has(name)) dupes.add(name); seen.add(name); }
  return dupes;
};

export { parseArgs };
