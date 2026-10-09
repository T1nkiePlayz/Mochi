import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko, Tofu } from "../../models";
import { listInstanceMods, type InstanceMod } from "../../lib/mods/instances";
import { installableUpdates } from "../../lib/mods/updates";
import { applyUpdates, ensureChecked, getUpdateState } from "../../state/modUpdates";
import { useApp } from "../../state/AppContext";

export type DirSize = { bytes: number; files: number; truncated: boolean };
export const getDirSize = (path: string) => invoke<DirSize>("get_dir_size", { path });

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

export type Row = {
  key: string;
  piko: Piko;
  tofu: Tofu;
  path: string;
  state: "loading" | "ready" | "error";
  files: InstanceMod[];
  size?: DirSize;
};

export type Progress = { label: string; done: number; total: number } | null;

/** Runs `worker` over `items` with a small concurrency limit. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next]; next += 1; await worker(item); }
  }));
}

/** Everything the Mods & Content view needs: per-Tofu mod lists and sizes. Update state lives in `state/modUpdates`. */
export function useInstalled(library: Piko[]) {
  const { behavior } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<Progress>(null);
  const [notice, setNotice] = useState("");
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const sources = useMemo(() => library.flatMap((piko) => piko.tofus.filter((tofu) => tofu.path).map((tofu) => ({ piko, tofu, path: tofu.path as string, key: `${piko.id}:${tofu.id}` }))), [library]);
  const sourceKey = sources.map((s) => `${s.key}@${s.path}`).join("|");

  const patch = useCallback((key: string, changes: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }, []);

  const scan = useCallback(async (only?: string) => {
    const targets = only ? sources.filter((s) => s.key === only) : sources;
    await pool(targets, 4, async (source) => {
      const [files, size] = await Promise.allSettled([listInstanceMods(source.tofu.id, source.path), getDirSize(source.path)]);
      patch(source.key, {
        state: files.status === "fulfilled" ? "ready" : "error",
        files: files.status === "fulfilled" ? files.value : [],
        size: size.status === "fulfilled" ? size.value : undefined,
      });
    });
  }, [sources, patch]);

  useEffect(() => {
    setRows((current) => sources.map((source) => {
      const existing = current.find((row) => row.key === source.key && row.path === source.path);
      return existing ? { ...existing, piko: source.piko, tofu: source.tofu } : { ...source, state: "loading", files: [] };
    }));
    // Once the lists are read, look for updates in the background (each Tofu at most every few hours); the view never waits for it.
    void scan().then(() => pool(rowsRef.current.filter((row) => row.files.length > 0), 2, async (row) => { await ensureChecked(row.tofu, row.piko, behavior.modSources); }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const check = useCallback(async (key: string) => {
    const row = rowsRef.current.find((item) => item.key === key);
    if (row) await ensureChecked(row.tofu, row.piko, behavior.modSources, true);
  }, [behavior.modSources]);

  const checkAll = useCallback(async () => {
    const targets = rowsRef.current.filter((row) => row.state === "ready" && row.files.length > 0);
    if (!targets.length) { setNotice("No mods to check yet."); return; }
    setNotice("");
    let done = 0;
    setProgress({ label: "Checking for updates", done, total: targets.length });
    await pool(targets, 2, async (row) => { await check(row.key); done += 1; setProgress({ label: "Checking for updates", done, total: targets.length }); });
    setProgress(null);
    const found = targets.reduce((sum, row) => sum + (getUpdateState(row.tofu.id).check?.items.length ?? 0), 0);
    const failed = targets.filter((row) => { const state = getUpdateState(row.tofu.id).check; return state && !state.items.length && state.notes.length > 0; }).length;
    setNotice(failed && failed === targets.length ? "Could not check for updates. Check your connection and try again." : found ? `${found} update${found === 1 ? "" : "s"} available.` : "Everything Mochi could identify is up to date.");
  }, [check]);

  const updateAll = useCallback(async (only?: string) => {
    const work = rowsRef.current.filter((row) => !only || row.key === only).map((row) => ({ row, mods: installableUpdates(getUpdateState(row.tofu.id).check?.items ?? []) })).filter((item) => item.mods.length);
    const total = work.reduce((sum, item) => sum + item.mods.length, 0);
    if (!total) return;
    let done = 0, failed = 0;
    setProgress({ label: "Updating mods", done, total });
    for (const { row, mods } of work) {
      for (const mod of mods) {
        const result = await applyUpdates(row.tofu, [mod]);
        failed += result.failed.length; done += 1;
        setProgress({ label: "Updating mods", done, total });
      }
      await scan(row.key);
    }
    setProgress(null);
    setNotice(failed ? `Updated ${done - failed} of ${total} mods; ${failed} failed.` : `Updated ${total} mod${total === 1 ? "" : "s"}.`);
  }, [scan]);

  return { rows, progress, notice, setNotice, rescan: () => scan(), check, checkAll, updateAll };
}
