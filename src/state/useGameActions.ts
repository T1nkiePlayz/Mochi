import { confirmAction } from "../lib/confirm";
import { useEffect, useRef, useState } from "react";
import type { Piko } from "../models";
import { launchGame as startGame, openPath, removeGameShortcut, stopGame } from "../lib/platform";
import { addPikoToSteam, createPikoShortcut, getShortcutTargets, runAddToSteam } from "../lib/shortcuts";
import { describeModSync, subscribeNative, type ModSyncResult } from "../lib/nativeEvents";
import { launchTargetFor } from "../lib/minecraftPiko";
import type { Behavior } from "./settings";
import { updateBeforeLaunch } from "./modUpdates";
import { askConflictChoice } from "../lib/mods/conflictPrompt";
import { checkTofuMods } from "../lib/mods/conflictService";
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

  /** Starts a game; `options.tofuId` launches that Tofu (a Minecraft instance), else the selected one, else the first. */
  const launchGame = async (piko: Piko = lib.selectedPiko, options: { skipConfirm?: boolean; tofuId?: string } = {}) => {
    const chosen = options.tofuId ? piko.tofus.find((item) => item.id === options.tofuId) : piko.id === lib.selectedPiko.id ? lib.selectedTofu : undefined;
    const tofu = chosen ?? piko.tofus[0];
    if (piko.id === "__empty" || !launchTargetFor(piko, tofu)) { setLaunchError("This game does not have a launch target. Edit the game to set one."); return; }
    if (launching.current.has(piko.id)) return;
    if (behavior.confirmLaunch && !options.skipConfirm && !await confirmAction({ title: `Launch ${piko.name}?`, message: "You can turn this question off under Settings → Data & privacy → Advanced settings.", confirmLabel: "Launch" })) return;
    setLaunchError("");
    launching.current.add(piko.id);
    setIsLaunching(true);
    try {
      // Offline and fast (local files only); a warning never blocks: the user can always launch anyway.
      if (tofu && !tofu.skipModCheck && tofu.path) {
        const issues = await checkTofuMods(piko, tofu);
        if (issues.length) {
          const choice = await askConflictChoice({ piko, tofu, issues });
          if (choice === "cancel") return;
          if (choice === "launch-and-silence") lib.updateGame(piko.id, { tofus: piko.tofus.map((item) => item.id === tofu.id ? { ...item, skipModCheck: true } : item) });
        }
      }
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

  const removeGame = async (game: Piko) => {
    if (!await confirmAction({ title: `Remove ${game.name}?`, danger: true, confirmLabel: "Remove", message: "It is removed from your Mochi library only, with its Tofus, tags and collection memberships. Nothing is uninstalled and no game files are deleted.", items: [game.name] })) return;
    void removeGameShortcut(game.id).catch(() => {});
    lib.setLibrary((current) => current.filter((piko) => piko.id !== game.id));
    lib.setGameDetailsId("");
    if (lib.selectedPikoId === game.id) { lib.setSelectedPikoId(""); lib.setSelectedTofuId(""); }
  };

  const createShortcut = async (game: Piko, location: string) => {
    try {
      await createPikoShortcut(game, location);
      notify("Shortcut created", location === "desktop" ? `${game.name} was added to your Desktop.` : location === "applications" ? `${game.name} was added to your Applications folder.` : `${game.name} now appears in your application menu.`);
    } catch (error) { setLaunchError(shortError(error)); }
  };

  const addToSteam = async (game: Piko, userId: string) => {
    try {
      const user = (await getShortcutTargets()).steamUsers.find((item) => item.id === userId);
      if (!user) { setLaunchError("That Steam account was not found."); return; }
      await runAddToSteam(game, user, { confirm: confirmAction, add: (id, allowRunning) => addPikoToSteam(game, id, allowRunning), notify });
    } catch (error) { setLaunchError(shortError(error)); }
  };

  const openGameFolder = (game: Piko) => {
    const folder = game.installPath || (game.executablePath?.startsWith("/") ? game.executablePath : "");
    if (folder) void openPath(folder).catch((error) => setLaunchError(shortError(error)));
  };

  return { launchError, setLaunchError, isLaunching, launchGame, stopRunningGame, removeGame, createShortcut, addToSteam, openGameFolder, shortError };
}

export type GameActions = ReturnType<typeof useGameActions>;
