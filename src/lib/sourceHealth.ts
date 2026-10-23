import type { SourceHealth } from "./sources";
import { readJson, writeJson } from "./storage";

const COUNTS_KEY = "mochi:source-health-counts";
const ANNOUNCED_KEY = "mochi:source-health-announced";
const REPORT_KEY = "mochi:source-health-report";
export const SOURCE_HEALTH_EVENT = "mochi:source-health";

/** Sources worth telling the user about: unreadable or partly unreadable files, or games that vanished while the files remain. */
export function healthAlerts(report: SourceHealth[], lastCounts: Record<string, number>): SourceHealth[] {
  return report.filter((health) => health.status === "parse_error" || health.status === "partial"
    || (health.status === "empty" && (lastCounts[health.id] ?? 0) > 0 && health.filesExamined > 0));
}

/** Remembers this scan's counts and returns the sources to warn about (each failing state is announced once per change). */
export function checkSourceHealth(report: SourceHealth[], store: { read: () => Record<string, number>; write: (counts: Record<string, number>) => void } = { read: () => readJson<Record<string, number>>(COUNTS_KEY, {}), write: (counts) => void writeJson(COUNTS_KEY, counts) }): SourceHealth[] {
  const last = store.read();
  const alerts = healthAlerts(report, last);
  const next = { ...last };
  // A broken scan reports zero games; keep the last good count so the drop is still seen next time.
  for (const health of report) { if (health.status === "ok" || health.status === "empty") next[health.id] = health.gameCount; }
  store.write(next);
  return alerts;
}

/** The most recent report seen from any scan, so passive readers (debug info) need not rescan. */
export const loadSourceReport = (): SourceHealth[] => readJson<SourceHealth[]>(REPORT_KEY, []);
export const saveSourceReport = (report: SourceHealth[]): void => { if (report.length) void writeJson(REPORT_KEY, report); };

/** Called after each scan: broadcasts the sources that need attention so one notice can be shown. */
export function noteSourceHealth(sources: Array<{ health?: SourceHealth }>): void {
  const report = sources.flatMap((source) => (source.health ? [source.health] : []));
  if (!report.length || typeof window === "undefined") return;
  saveSourceReport(report);
  const alerts = checkSourceHealth(report);
  // The background watcher re-scans every few minutes: announce a problem again only when it changes.
  const signature = alerts.map((alert) => `${alert.id}:${alert.status}`).join(",");
  const previous = readJson<string>(ANNOUNCED_KEY, "");
  if (signature !== previous) writeJson(ANNOUNCED_KEY, signature);
  if (alerts.length && signature !== previous) window.dispatchEvent(new CustomEvent(SOURCE_HEALTH_EVENT, { detail: alerts }));
}
