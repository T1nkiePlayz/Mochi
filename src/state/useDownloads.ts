import { useCallback, useEffect, useRef, useState } from "react";
import { keepIfEqual } from "../lib/equal";
import { getDownloads, type DownloadEntry } from "../lib/modrinth";
import { subscribeNative } from "../lib/nativeEvents";
import { translate } from "../lib/i18n";

/** The native side owns download state; poll it while the Downloads page is open or anything is in flight. */
export function useDownloads(active: boolean, notify: (title: string, message: string, opts?: { group?: string; item?: string }) => void, language: unknown) {
  const t = useCallback((message: string) => translate(message, language), [language]);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const statuses = useRef(new Map<string, string>());
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const seq = useRef(0);
  const hasActive = downloads.some((download) => download.status === "downloading");

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const mine = ++seq.current;
        const next = await getDownloads();
        if (cancelled || mine !== seq.current) return;
        for (const download of next) {
          if (statuses.current.get(download.id) === "downloading" && download.status !== "downloading" && download.status !== "cancelled") {
            notifyRef.current(
              download.status === "completed" ? t("Download finished") : t("Download failed"),
              download.status === "completed"
                ? t("{name} was added to {tofu}.").replace("{name}", download.itemName).replace("{tofu}", download.tofuName)
                : `${download.itemName}: ${t("Failed")}. ${download.error ?? t("Unknown error")}`,
              download.status === "completed" ? { group: "downloads", item: download.itemName } : undefined);
          }
          statuses.current.set(download.id, download.status);
        }
        setDownloads(keepIfEqual(next));
      } catch { /* browser/development mode */ }
    };
    void poll();
    // The in-memory list is cheap to read; poll faster while the user is watching it and back off to 30s
    // when nothing is in flight (starts and finishes still arrive at once via the native event below).
    // Nobody is looking while the window is hidden (minimised, tray), so skip those ticks and catch up on return.
    const tick = () => { if (!document.hidden) void poll(); };
    const timer = window.setInterval(tick, active || hasActive ? 1500 : 30000);
    document.addEventListener("visibilitychange", tick);
    // The native side announces every start, finish and cancel, so the list reacts at once instead of on the next tick.
    const unsubscribe = subscribeNative("mod-download-changed", () => void poll());
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); unsubscribe(); };
  }, [active, hasActive, t]);

  return downloads;
}
