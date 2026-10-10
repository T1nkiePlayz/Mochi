import type { LaunchOptions, TofuLaunchConfig } from "../models";

export const defaultLaunchConfig = (): TofuLaunchConfig => ({ wrappers: [], args: "", env: "" });

/**
 * Splits a command line into arguments the way a POSIX shell would split words (no expansion): single quotes are
 * literal, double quotes allow \" and \\ escapes, and a backslash outside quotes escapes the next character.
 */
export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  const chars = Array.from(input.trim());
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index] as string;
    if (quote === "'") {
      if (char === "'") quote = null; else current += char;
    } else if (quote === '"') {
      const next = chars[index + 1];
      if (char === '"') quote = null;
      else if (char === "\\" && (next === '"' || next === "\\")) { current += next; index++; }
      else current += char;
    } else if (char === "\\" && index + 1 < chars.length) {
      current += chars[++index];
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
    }
  }
  if (started || current) args.push(current);
  return args;
}

/** Quotes arguments so that `parseArgs(formatArgs(args))` gives them back. */
export function formatArgs(args: string[]): string {
  return args.map((arg) => arg !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`).join(" ");
}

/** Parses `KEY=value` lines, ignoring blanks, comments and invalid names. */
export function parseEnv(input: string): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const line of input.split("\n")) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && match[1] !== undefined) entries.push([match[1], match[2] ?? ""]);
  }
  // fromEntries defines own properties, so a variable named __proto__ cannot touch the object's prototype.
  return Object.fromEntries(entries);
}

export const defaultLaunchOptions = (): LaunchOptions => ({ env: [], args: [] });

/** Whether the options change anything (an untouched game stores nothing). */
export function hasLaunchOptions(options: LaunchOptions | undefined): boolean {
  if (!options) return false;
  return options.env.length > 0 || options.args.length > 0 || !!options.workingDir || (!!options.runtime && options.runtime.kind !== "native") || !!options.gamemode || !!options.mangohud || !!options.gamescope?.enabled;
}

/** The runtime id the launcher expects for the options' runtime choice ("native" means automatic). */
export function runtimeIdOf(runtime: LaunchOptions["runtime"]): string | undefined {
  if (!runtime || runtime.kind === "native") return undefined;
  return runtime.kind === "wine" ? "wine" : runtime.id || undefined;
}

/** The native launcher's representation of a game's launch settings: the Piko's options, then the Tofu's on top. */
export function buildLaunchConfig(config: TofuLaunchConfig | undefined, options?: LaunchOptions) {
  const tofuArgs = parseArgs(config?.args ?? "");
  const wrappers = new Set(config?.wrappers ?? []);
  if (options?.gamemode) wrappers.add("gamemoderun");
  if (options?.mangohud) wrappers.add("mangohud");
  // Rows with neither a name nor a value are blank lines; anything else goes to the launcher, which rejects bad names with a message.
  const rows = (options?.env ?? []).filter(([key, value]) => key.trim() !== "" || value !== "").map(([key, value]): [string, string] => [key.trim(), value]);
  return {
    runtime: config?.runtime || runtimeIdOf(options?.runtime) || null,
    wrappers: [...wrappers],
    args: tofuArgs.length ? tofuArgs : options?.args ?? [],
    // fromEntries defines own properties, so a variable named __proto__ cannot touch the object's prototype.
    env: Object.fromEntries([...rows, ...Object.entries(parseEnv(config?.env ?? ""))]) as Record<string, string>,
    workingDir: config?.workingDir || options?.workingDir || null,
    gamescope: { enabled: !!options?.gamescope?.enabled, args: options?.gamescope?.args ?? [] },
    hooks: { pre: parseArgs(options?.hooks?.pre ?? ""), post: parseArgs(options?.hooks?.post ?? "") },
  };
}
