import { useCallback, useRef, useState } from "react";
import { importSteamPlaytime, type SteamPlaytimeImportResult, type SteamPlaytimeTarget } from "../lib/steamPlaytime";

export type SteamPlaytimeImportState =
  | { status: "idle" }
  | { status: "importing" }
  | { status: "done"; result: SteamPlaytimeImportResult }
  | { status: "error"; message: string };

/**
 * The one-shot Steam playtime import: idle → importing → result or error.
 * Never runs twice at once; an empty list is a no-op.
 */
export function useSteamPlaytimeImport() {
  const [state, setState] = useState<SteamPlaytimeImportState>({ status: "idle" });
  const running = useRef(false);

  const run = useCallback(async (targets: SteamPlaytimeTarget[]): Promise<SteamPlaytimeImportResult | null> => {
    if (running.current || !targets.length) return null;
    running.current = true;
    setState({ status: "importing" });
    try {
      const result = await importSteamPlaytime(targets);
      setState({ status: "done", result });
      return result;
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      running.current = false;
    }
  }, []);

  return { state, run };
}
