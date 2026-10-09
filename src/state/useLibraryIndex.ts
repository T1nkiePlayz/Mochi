import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Piko } from "../models";

const DEBOUNCE_MS = 2000;

/** Mirrors the library's ids and names to `library-index.json` so `mochi list` / `mochi launch` can read them without the app. */
export function useLibraryIndex(library: readonly Piko[], ready: boolean) {
  useEffect(() => {
    if (!ready || !("__TAURI_INTERNALS__" in window)) return;
    const timer = window.setTimeout(() => {
      const entries = library.filter((piko) => piko.id !== "__empty").map((piko) => ({ id: piko.id, name: piko.name, kind: piko.kind ?? "game" }));
      void invoke("write_library_index", { entries }).catch((error) => console.warn("Mochi library index not written", error));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [library, ready]);
}
