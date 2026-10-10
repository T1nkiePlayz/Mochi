import { useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { backupDue, readSchedule, runScheduledBackup, writeSchedule } from "../lib/libraryBackup";

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 3_600_000;

/** Writes the scheduled library copy when it is due (checked shortly after start and then hourly). Failures are reported once per check. */
export function useScheduledBackup(ready: boolean, notify: (title: string, message: string) => void) {
  useEffect(() => {
    if (!ready) return;
    let running = false;
    const check = async () => {
      const schedule = readSchedule();
      if (running || !backupDue(schedule)) return;
      running = true;
      try {
        await runScheduledBackup(schedule, await getVersion().catch(() => ""));
        writeSchedule({ ...readSchedule(), lastAt: Date.now() });
      } catch (error) {
        notify("Library backup failed", error instanceof Error ? error.message : typeof error === "string" ? error : "The backup folder is not available.");
        // Try again tomorrow instead of every hour.
        writeSchedule({ ...readSchedule(), lastAt: Date.now() - (schedule.everyDays - 1) * 86_400_000 });
      } finally { running = false; }
    };
    const first = window.setTimeout(() => void check(), FIRST_CHECK_MS);
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
}
