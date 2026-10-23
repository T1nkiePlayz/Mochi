import { useEffect, useRef } from "react";
import { translateUiMessage } from "../lib/i18n";
import { SOURCE_HEALTH_EVENT } from "../lib/sourceHealth";
import type { SourceHealth } from "../lib/sources";

/** Shows one notice naming the launchers whose files could not be read after a scan. */
export function useSourceHealthNotices(notify: (title: string, message: string) => void) {
  const latest = useRef(notify);
  latest.current = notify;
  useEffect(() => {
    const listener = (event: Event) => {
      const alerts = (event as CustomEvent<SourceHealth[]>).detail ?? [];
      if (!alerts.length) return;
      const names = alerts.map((alert) => alert.name).join(", ");
      latest.current(translateUiMessage("Source health"), translateUiMessage("Mochi could not fully read the files of {sources}, so games may be missing. See Settings > Library tools > Source health.").replace("{sources}", names));
    };
    window.addEventListener(SOURCE_HEALTH_EVENT, listener);
    return () => window.removeEventListener(SOURCE_HEALTH_EVENT, listener);
  }, []);
}
