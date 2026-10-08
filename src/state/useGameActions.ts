import { useState } from "react";
import type { Piko } from "../models";
import { createGameShortcut, launchGame as startGame, openPath, removeGameShortcut, stopGame } from "../lib/platform";
import type { Behavior } from "./settings";
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

  const shortError = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    return behavior.detailedErrors ? text : text.split(/(?<=[.!?])\s/)[0];
  };

  const launchGame = async (piko: Piko = lib.selectedPiko, options: { skipConfirm?: boolean } = {}) => {
    if (piko.id === "__empty" || !piko.executablePath) { setLaunchError("This game does not have a launch target. Edit the game to set one."); return; }
    if (behavior.confirmLaunch && !options.skipConfirm && !window.confirm(`Launch ${piko.name}?`)) return;
    setLaunchError("");
    setIsLaunching(true);
    try {
      const tofu = piko.id === lib.selectedPiko.id ? lib.selectedTofu : piko.tofus[0];
      await startGame(piko, tofu);
      await Promise.all([refreshPlaytime(), refreshSessions()]);
    } catch (error) {
      setLaunchError(shortError(error));
    } finally { setIsLaunching(false); }
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
