import { invoke } from "@tauri-apps/api/core";

export type LogSession = { id: string; startedAt: number; size: number; /** False when the game was started through another launcher (Steam, Flatpak, macOS `open`): nothing was captured. */ direct: boolean };
export type LogList = { dir: string; sessions: LogSession[] };
export type LogChunk = { text: string; offset: number; size: number; reset: boolean; cutStart: boolean };

export const listGameLogs = (gameId: string) => invoke<LogList>("list_game_logs", { gameId });
/** First read: pass no `from` to get the newest part. Following: pass the previous `offset`. */
export const readGameLog = (gameId: string, sessionId: string, from?: number, maxBytes?: number) =>
  invoke<LogChunk>("read_game_log", { gameId, sessionId, from: from ?? null, maxBytes: maxBytes ?? null });
export const clearGameLogs = (gameId: string) => invoke<number>("clear_game_logs", { gameId });

/** Appends a chunk to what is shown, restarting when the file was cut, and keeps the buffer bounded. */
export function appendLog(current: string, chunk: Pick<LogChunk, "text" | "reset" | "cutStart">, maxChars = 400_000): string {
  const joined = chunk.reset || chunk.cutStart ? chunk.text : current + chunk.text;
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined;
}

/** What to tell the user when a game's output cannot be captured, by platform. */
export function handoffHelp(platform: "linux" | "macos" | string): string {
  return platform === "macos"
    ? "This game was started through another app (Steam, a launcher or an .app opened by macOS), so Mochi cannot see its output. Look in the Console app, in ~/Library/Logs, or in the launcher's own logs."
    : "This game was started through another program (Steam, Flatpak or a launcher), so Mochi cannot see its output. For Steam games add PROTON_LOG=1 %command% to the launch options (log in your home folder); Steam's own logs are in ~/.local/share/Steam/logs; Flatpak apps log to the journal (journalctl --user).";
}
