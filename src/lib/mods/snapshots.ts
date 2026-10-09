import { invoke } from "@tauri-apps/api/core";
import type { Tofu } from "../../models";
import { contentFolder } from "./targets";

/** One saved state of a Tofu's mod files and records (see docs/snapshots.md). */
export type SnapshotInfo = {
  id: string; createdAt: number; reason: string;
  /** Made by a restore as its safety copy; never offered as the "last working state". */
  isRestore: boolean;
  files: number; size: number; folders: number;
  /** Nothing had changed, so the latest snapshot was returned instead of a new one. */
  reused: boolean;
};
export type RestoreReport = { restored: number; removed: number; unchanged: number; safetySnapshotId: string };

export const createTofuSnapshot = (tofuId: string, folders: string[], reason: string) => invoke<SnapshotInfo>("create_tofu_snapshot", { tofuId, folders, reason });
/** Newest first. */
export const listTofuSnapshots = (tofuId: string) => invoke<SnapshotInfo[]>("list_tofu_snapshots", { tofuId });
export const restoreTofuSnapshot = (tofuId: string, snapshotId: string) => invoke<RestoreReport>("restore_tofu_snapshot", { tofuId, snapshotId });
export const deleteTofuSnapshot = (tofuId: string, snapshotId: string) => invoke<void>("delete_tofu_snapshot", { tofuId, snapshotId });

/** The content folders of a Tofu that a snapshot covers: mods, resource packs and shader packs (missing ones are skipped natively). */
export function snapshotFolders(tofu: Pick<Tofu, "path" | "gameDir" | "contentRoot">): string[] {
  const out: string[] = [];
  for (const kind of ["mod", "resourcepack", "shader"] as const) {
    const folder = contentFolder(tofu, kind);
    if (!folder) continue;
    const path = folder.subdir ? `${folder.path.replace(/\/+$/, "")}/${folder.subdir}` : folder.path;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** The newest snapshot that is not a restore's safety copy: the state to go back to after something broke. */
export const lastWorkingSnapshot = (snapshots: readonly SnapshotInfo[]): SnapshotInfo | undefined =>
  [...snapshots].filter((snapshot) => !snapshot.isRestore).sort((a, b) => b.createdAt - a.createdAt)[0];

/** Raised when the snapshot before a change could not be saved; the change was not made. */
export class SnapshotError extends Error {}

const text = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error");
/** Drops the machine prefixes the native side puts on its "skip" errors. */
export const cleanSnapshotError = (message: string) => message.replace(/^snapshot-(too-large|empty):\s*/, "");
const isSkippable = (message: string) => /^snapshot-(too-large|empty):/.test(message);

export type SnapshotOptions = {
  /** Replaceable for tests. */
  create?: (tofuId: string, folders: string[], reason: string) => Promise<unknown>;
  /** Called when the snapshot was skipped on purpose (too big, or nothing to save) and `fn` runs anyway. */
  onSkipped?: (message: string) => void;
};

/**
 * Saves a snapshot of the Tofu, then runs `fn`. Use it before anything that rewrites mod files (updates, dependency installs,
 * multi-installs). Order: snapshot first, `fn` second. If the snapshot fails, `fn` is NOT run and a `SnapshotError` is thrown, so
 * the user never loses their only copy; two cases are not failures and let `fn` run: the Tofu is too big to snapshot, or there
 * is nothing to save yet. Errors from `fn` propagate unchanged. A Tofu without a folder just runs `fn`.
 */
export async function withSnapshot<T>(tofu: Pick<Tofu, "id" | "path" | "gameDir" | "contentRoot">, reason: string, fn: () => Promise<T>, options: SnapshotOptions = {}): Promise<T> {
  if (tofu.path) {
    try { await (options.create ?? createTofuSnapshot)(tofu.id, snapshotFolders(tofu), reason); } catch (error) {
      const message = text(error);
      if (isSkippable(message)) options.onSkipped?.(cleanSnapshotError(message));
      else throw new SnapshotError(`Could not save a snapshot first, so nothing was changed: ${message}`);
    }
  }
  return fn();
}
