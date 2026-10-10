import { invoke } from "@tauri-apps/api/core";

export type PrefixInfo = {
  path: string;
  exists: boolean;
  kind: "none" | "wine" | "proton" | "unknown";
  hasBackup: boolean;
  supported: boolean;
  hasWinetricks: boolean;
  busy: boolean;
  verbs: Array<{ id: string; label: string }>;
};
export type PrefixTool = "winecfg" | "regedit" | "wineboot" | "winetricks";
export type PrefixDone = { gameId: string; tool: string; ok: boolean; message: string };

const ids = (gameId: string, tofuId?: string) => ({ gameId, tofuId: tofuId ?? null });

export const getPrefixInfo = (gameId: string, tofuId?: string) => invoke<PrefixInfo>("get_prefix_info", ids(gameId, tofuId));
export const resetPrefix = (gameId: string, tofuId?: string) => invoke<void>("reset_game_prefix", ids(gameId, tofuId));
export const restorePrefix = (gameId: string, tofuId?: string) => invoke<void>("restore_game_prefix", ids(gameId, tofuId));
export const deletePrefixBackup = (gameId: string, tofuId?: string) => invoke<void>("delete_game_prefix_backup", ids(gameId, tofuId));
export const runPrefixTool = (gameId: string, tofuId: string | undefined, runtime: string | undefined, tool: PrefixTool, verb?: string) =>
  invoke<void>("run_prefix_tool", { ...ids(gameId, tofuId), runtime: runtime ?? null, tool, verb: verb ?? null });

const kindLabels: Record<PrefixInfo["kind"], string> = { none: "Not created yet", wine: "Wine prefix", proton: "Proton prefix", unknown: "Empty or unrecognised" };
export const prefixKindLabel = (kind: PrefixInfo["kind"]): string => kindLabels[kind];

/** The one-line status under the prefix path. */
export function describePrefix(info: PrefixInfo, bytes?: number | null): string {
  if (!info.exists) return "No prefix yet. Mochi creates it the first time the game starts.";
  const size = bytes != null ? ` · ${bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`}` : "";
  return `${prefixKindLabel(info.kind)}${size}`;
}
