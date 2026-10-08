import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko, Tofu } from "../../models";
import { analyzeModFiles, listInstalledMods, updateModFile, type InstalledModrinthFile, type ModAnalysis } from "../../lib/modrinth";

export type DirSize = { bytes: number; files: number; truncated: boolean };
export const getDirSize = (path: string) => invoke<DirSize>("get_dir_size", { path });

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
};

const LOADERS = ["neoforge", "fabric", "quilt", "forge"];
/** Loader and game version are only known when the Tofu's own fields say so. */
export function tofuTarget(tofu: Tofu): { loader?: string; gameVersion?: string } {
  const text = `${tofu.runtime} ${tofu.name} ${tofu.version}`.toLowerCase();
  const loader = LOADERS.find((name) => text.includes(name));
  const gameVersion = /\b1\.\d{1,2}(\.\d{1,2})?\b/.exec(tofu.version)?.[0] ?? /\b1\.\d{1,2}(\.\d{1,2})?\b/.exec(tofu.runtime)?.[0];
  return { loader, gameVersion };
}

export type Row = {
  key: string;
  piko: Piko;
  tofu: Tofu;
  path: string;
  state: "loading" | "ready" | "error";
  files: InstalledModrinthFile[];
  size?: DirSize;
  analysis?: ModAnalysis[];
  check: "idle" | "checking" | "done" | "error";
  checkError?: string;
  updating: Set<string>;
};

export type Progress = { label: string; done: number; total: number } | null;

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : typeof error === "string" ? error : fallback);

/** Runs `worker` over `items` with a small concurrency limit. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const item = items[next]; next += 1; await worker(item); }
  }));
}

/** Everything the Installed view needs: per-Tofu mod lists, sizes and update state. */
export function useInstalled(library: Piko[]) {
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<Progress>(null);
  const [notice, setNotice] = useState("");
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const sources = useMemo(() => library.flatMap((piko) => piko.tofus.filter((tofu) => tofu.path).map((tofu) => ({ piko, tofu, path: tofu.path as string, key: `${piko.id}:${tofu.id}` }))), [library]);
  const sourceKey = sources.map((s) => `${s.key}@${s.path}`).join("|");

  const patch = useCallback((key: string, changes: Partial<Row> | ((row: Row) => Partial<Row>)) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...(typeof changes === "function" ? changes(row) : changes) } : row)));
  }, []);

  const scan = useCallback(async (only?: string) => {
    const targets = only ? sources.filter((s) => s.key === only) : sources;
    await pool(targets, 4, async (source) => {
      const [files, size] = await Promise.allSettled([listInstalledMods(source.path), getDirSize(source.path)]);
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
      return existing ? { ...existing, piko: source.piko, tofu: source.tofu } : { ...source, state: "loading", files: [], check: "idle", updating: new Set() };
    }));
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  const check = useCallback(async (key: string) => {
    const row = rowsRef.current.find((item) => item.key === key);
    if (!row) return;
    patch(key, { check: "checking", checkError: undefined });
    try {
      const { loader, gameVersion } = tofuTarget(row.tofu);
      patch(key, { analysis: await analyzeModFiles(row.path, gameVersion, loader), check: "done" });
    } catch (error) {
      patch(key, { check: "error", checkError: navigator.onLine ? message(error, "Update check failed.") : "You are offline. Updates need an internet connection." });
    }
  }, [patch]);

  const checkAll = useCallback(async () => {
    const keys = rowsRef.current.filter((row) => row.state === "ready" && row.files.length > 0).map((row) => row.key);
    if (!keys.length) { setNotice("No mods to check yet."); return; }
    setNotice("");
    let done = 0;
    setProgress({ label: "Checking for updates", done, total: keys.length });
    await pool(keys, 2, async (key) => { await check(key); done += 1; setProgress({ label: "Checking for updates", done, total: keys.length }); });
    setProgress(null);
    const found = rowsRef.current.reduce((sum, row) => sum + (row.analysis?.filter((item) => item.update).length ?? 0), 0);
    const failed = rowsRef.current.filter((row) => row.check === "error").length;
    setNotice(failed && failed === keys.length ? "Could not reach Modrinth. Check your connection and try again." : found ? `${found} update${found === 1 ? "" : "s"} available.` : "Everything Mochi could identify is up to date.");
  }, [check]);

  const updateMods = useCallback(async (key: string, mods: ModAnalysis[]) => {
    const row = rowsRef.current.find((item) => item.key === key);
    if (!row) return { ok: 0, failed: 0 };
    let ok = 0, failed = 0;
    for (const mod of mods) {
      if (!mod.update) continue;
      patch(key, (current) => ({ updating: new Set(current.updating).add(mod.path) }));
      try {
        await updateModFile(mod.path, mod.update);
        ok += 1;
        patch(key, (current) => ({ analysis: current.analysis?.filter((item) => item.path !== mod.path) }));
      } catch { failed += 1; }
      patch(key, (current) => { const next = new Set(current.updating); next.delete(mod.path); return { updating: next }; });
    }
    await scan(key);
    return { ok, failed };
  }, [patch, scan]);

  const updateOne = useCallback(async (key: string, mod: ModAnalysis) => {
    const result = await updateMods(key, [mod]);
    setNotice(result.ok ? `Updated ${mod.title} to ${mod.update?.versionNumber}.` : `Could not update ${mod.title}.`);
  }, [updateMods]);

  const updateAll = useCallback(async (only?: string) => {
    const work = rowsRef.current.filter((row) => !only || row.key === only).map((row) => ({ key: row.key, mods: (row.analysis ?? []).filter((item) => item.update) })).filter((item) => item.mods.length);
    const total = work.reduce((sum, item) => sum + item.mods.length, 0);
    if (!total) return;
    let done = 0, failed = 0;
    setProgress({ label: "Updating mods", done, total });
    for (const item of work) {
      for (const mod of item.mods) {
        const result = await updateMods(item.key, [mod]);
        failed += result.failed; done += 1;
        setProgress({ label: "Updating mods", done, total });
      }
    }
    setProgress(null);
    setNotice(failed ? `Updated ${done - failed} of ${total} mods; ${failed} failed.` : `Updated ${total} mod${total === 1 ? "" : "s"}.`);
  }, [updateMods]);

  return { rows, progress, notice, setNotice, rescan: () => scan(), check, checkAll, updateOne, updateAll };
}
