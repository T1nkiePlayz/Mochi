import { listen } from "@tauri-apps/api/event";

/** Subscribes to an event from the native side; returns the cleanup. A no-op in the browser dev server. */
export function subscribeNative<T>(event: string, handler: (payload: T) => void): () => void {
  let off: (() => void) | undefined;
  let disposed = false;
  void listen<T>(event, (message) => handler(message.payload)).then((unlisten) => { if (disposed) unlisten(); else off = unlisten; }).catch(() => { /* browser/development mode */ });
  return () => { disposed = true; off?.(); };
}

export type ModSyncResult = { tofuId: string; report?: { added: number; removed: number; unchanged: number; enabled?: number; disabled?: number; conflicts: string[]; errors: string[] } | null; error?: string | null };

/** The one-line summary of a launch-time mod sync, or null when there is nothing worth telling the user. */
export function describeModSync(result: ModSyncResult, tofuName: string): { title: string; message: string } | null {
  if (result.error) return { title: "Mods were not synced", message: result.error };
  const report = result.report;
  if (!report) return null;
  if (report.errors.length) return { title: "Some mods were not synced", message: report.errors[0] };
  if (report.conflicts.length) return { title: "Mods left untouched", message: report.conflicts[0] };
  const on = (report.added ?? 0) + (report.enabled ?? 0);
  const off = (report.removed ?? 0) + (report.disabled ?? 0);
  if (!on && !off) return null;
  return { title: "Mods ready", message: `${tofuName}: ${on} added, ${off} removed.` };
}
