import type { TofuLaunchConfig } from "../models";

export const defaultLaunchConfig = (): TofuLaunchConfig => ({ wrappers: [], args: "", env: "" });

/** Splits a command line into arguments, honouring single and double quotes. */
export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
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

/** Parses `KEY=value` lines, ignoring blanks, comments and invalid names. */
export function parseEnv(input: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of input.split("\n")) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/** The native launcher's representation of a Tofu's launch settings. */
export function buildLaunchConfig(config: TofuLaunchConfig | undefined) {
  return {
    runtime: config?.runtime || null,
    wrappers: config?.wrappers ?? [],
    args: parseArgs(config?.args ?? ""),
    env: parseEnv(config?.env ?? ""),
    workingDir: config?.workingDir || null,
  };
}
