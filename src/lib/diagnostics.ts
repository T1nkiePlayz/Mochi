/** Removes what should not be pasted into a public bug report: home folders, emails and token-like strings. */
export function redact(text: string, home?: string | null): string {
  let out = text;
  if (home && home.length > 1) out = out.split(home).join("~");
  out = out.replace(/\/(home|Users)\/[^/\s"'`]+/g, "/$1/<user>");
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, "C:\\Users\\<user>");
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>");
  out = out.replace(/\b(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})\b/g, "<token>");
  out = out.replace(/\b(sk|pk|ghp|gho|xox[bp])[-_][\w-]{16,}\b/g, "<token>");
  out = out.replace(/\b[A-Fa-f0-9]{32,}\b/g, "<secret>");
  out = out.replace(/((?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1<redacted>");
  return out;
}

export type DiagnosticsInput = {
  version: string;
  platform: { platform: string; displayName: string; isSteamDeck: boolean; isGamescope: boolean; launchMethods: string[] };
  userAgent: string;
  online: boolean;
  gameCount: number;
  gamesBySource: Record<string, number>;
  experimental: string[];
  signedIn: boolean;
  home?: string | null;
  recentLog?: { game: string; text: string } | null;
};

/** Builds a plain-text, secret-free report a user can paste into a bug report. */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const lines = [
    "Mochi diagnostics",
    `Version: ${input.version}`,
    `Platform: ${input.platform.displayName} (${input.platform.platform})${input.platform.isSteamDeck ? ", Steam Deck" : ""}${input.platform.isGamescope ? ", gamescope" : ""}`,
    `Launch methods: ${input.platform.launchMethods.join(", ") || "none"}`,
    `Webview: ${input.userAgent}`,
    `Online: ${input.online ? "yes" : "no"}`,
    `Signed in: ${input.signedIn ? "yes" : "no"}`,
    `Games: ${input.gameCount}${Object.keys(input.gamesBySource).length ? ` (${Object.entries(input.gamesBySource).map(([source, count]) => `${source} ${count}`).join(", ")})` : ""}`,
    `Experimental features: ${input.experimental.join(", ") || "none"}`,
  ];
  if (input.recentLog?.text.trim()) lines.push("", `Last game output (${input.recentLog.game}):`, "```", input.recentLog.text.trim().split("\n").slice(-60).join("\n"), "```");
  return redact(lines.join("\n"), input.home);
}
