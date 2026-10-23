import { invoke } from "@tauri-apps/api/core";

export type RuntimeKind = "proton" | "wine";
export type RuntimeRelease = { tag: string; name: string; publishedAt: string | null; size: number; installed: boolean };
export type InstalledRuntime = { name: string; path: string };
export type InstalledRuntimes = { root: string | null; runtimes: InstalledRuntime[] };
export type RuntimeInstallPhase = "preparing" | "downloading" | "verifying" | "extracting" | "done" | "failed";
export type RuntimeInstallProgress = { kind: RuntimeKind; tag: string; phase: RuntimeInstallPhase; downloaded: number; total: number | null };

export const runtimeInstallProgressEvent = "runtime-install-progress";

export const listInstalledRuntimes = (kind: RuntimeKind) => invoke<InstalledRuntimes>("list_installed_runtimes", { kind });
export const listRuntimeReleases = (kind: RuntimeKind) => invoke<RuntimeRelease[]>("list_runtime_releases", { kind });
export const installRuntime = (kind: RuntimeKind, tag: string) => invoke<string>("install_runtime", { kind, tag });
export const removeRuntime = (kind: RuntimeKind, name: string) => invoke<void>("remove_runtime", { kind, name });

/** 0-100 for the download phase, or null when the size is unknown. */
export function installPercent(progress: Pick<RuntimeInstallProgress, "downloaded" | "total">): number | null {
  return progress.total ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100)) : null;
}

export function formatRuntimeSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}
