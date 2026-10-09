import { useEffect, useRef, useState } from "react";
import type { Piko } from "../models";
import { createGameShortcut, launchGame as startGame, openPath, removeGameShortcut, stopGame } from "../lib/platform";
import { describeModSync, subscribeNative, type ModSyncResult } from "../lib/nativeEvents";
import type { Behavior } from "./settings";
import { updateBeforeLaunch } from "./modUpdates";
import type { LibraryState } from "./useLibrary";

type Params = {
  lib: LibraryState;
  behavior: Behavior;
  refreshPlaytime: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  notify: (title: string, message: string) => void;
};

/** Launch, stop, remove and shortcut actions for games. */
export function useGameActions({ lib, behavior, refreshPlaytime, refreshSessions, notify }: Params) {
  const [launchError, setLaunchError] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  // Double clicks, Enter-repeat and deep links must not start the same game twice.
  const launching = useRef(new Set<string>());

  // The native side copies a Tofu's own mods into the game folder right before the game starts and reports what it did.
  const libraryRef = useRef(lib.library);
  libraryRef.current = lib.library;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  useEffect(() => subscribeNative<ModSyncResult>("mod-sync-result", (result) => {
    const name = libraryRef.current.flatMap((piko) => piko.tofus).find((tofu) => tofu.id === result.tofuId)?.name ?? "Tofu";
    const summary = describeModSync(result, name);
    if (summary) notifyRef.current(summary.title, summary.message);
  }), []);

  const shortError = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    // No regex look-behind: older macOS WebKit rejects it at parse time and the whole app fails to load.
    return behavior.detailedErrors ? text : (/^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text);
  };

  const launchGame = async (piko: Piko = lib.selectedPiko, options: { skipConfirm?: boolean } = {}) => {
    if (piko.id === "__empty" || !piko.executablePath) { setLaunchError("This game does not have a launch target. Edit the game to set one."); return; }
    if (launching.current.has(piko.id)) return;
    if (behavior.confirmLaunch && !options.skipConfirm && !window.confirm(`Launch ${piko.name}?`)) return;
    setLaunchError("");
    launching.current.add(piko.id);
    setIsLaunching(true);
    try {
      const tofu = piko.id === lib.selectedPiko.id ? lib.selectedTofu : piko.tofus[0];
      // Optional and off by default: bring the Tofu's mods up to date first (bounded wait; launching always continues).
      if (behavior.autoUpdateMods && tofu) await updateBeforeLaunch(tofu, piko, behavior.modSources, notify);
      await startGame(piko, tofu);
      await Promise.all([refreshPlaytime(), refreshSessions()]);
    } catch (error) {
      setLaunchError(shortError(error));
    } finally { launching.current.delete(piko.id); setIsLaunching(launching.current.size > 0); }
  };

  const stopRunningGame = async (piko: Piko) => {
    try { await stopGame(piko.id); } catch (error) { setLaunchError(shortError(error)); }
  };

  const removeGame = (game: Piko) => {
    if (!window.confirm(`Remove ${game.name} from your Mochi library? The game itself is not uninstalled.`)) return;
    void removeGameShortcut(game.id).catch(() => {});
    lib.setLibrary((current) => current.filter((piko) => piko.id !== game.id));
    lib.setGameDetailsId("");
    if (lib.selectedPikoId === game.id) { lib.setSelectedPikoId(""); lib.setSelectedTofuId(""); }
  };

  const addShortcut = async (game: Piko) => {
    try {
      await createGameShortcut(game.id, game.name);
      notify("Shortcut added", `${game.name} now appears in your application menu.`);
    } catch (error) { setLaunchError(shortError(error)); }
  };

  const openGameFolder = (game: Piko) => {
    const folder = game.installPath || (game.executablePath?.startsWith("/") ? game.executablePath : "");
    if (folder) void openPath(folder).catch((error) => setLaunchError(shortError(error)));
  };

  return { launchError, setLaunchError, isLaunching, launchGame, stopRunningGame, removeGame, addShortcut, openGameFolder, shortError };
}

export type GameActions = ReturnType<typeof useGameActions>;
