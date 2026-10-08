import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { supabase } from "../lib/supabase";
import { useGameSessions } from "../hooks";
import { useThemeEngine } from "../lib/theme";
import { getPlatformCapabilities, listRuntimes, type PlatformCapabilities, type RuntimeInfo } from "../lib/platform";
import type { ImportedGame, ImportSourceId } from "../lib/sources";
import { readJson, readString, storageKeys, writeJson, writeString } from "../lib/storage";
import { normalizeBehavior, type Behavior } from "./settings";
import { useNotifications } from "./useNotifications";
import { useAccount } from "./useAccount";
import { useCredentials } from "./useCredentials";
import { useLibrary } from "./useLibrary";
import { usePlaytime } from "./usePlaytime";
import { useProfileStorage } from "./useProfileStorage";
import { useCloudSync } from "./useCloudSync";
import { useDownloads } from "./useDownloads";
import { useMetadata } from "./useMetadata";
import { useAddGame } from "./useAddGame";
import { useGameActions } from "./useGameActions";
import { useDeepLinks } from "./useDeepLinks";

export type NavId = "Library" | "Installed" | "Discover" | "Downloads" | "Stats" | "Settings";

function useAppController() {
  // Read synchronously: effects (launch on startup, Big Picture on startup) must never see defaults first.
  const [behavior, setBehavior] = useState<Behavior>(() => normalizeBehavior(readJson(storageKeys.settings, {})));
  const [activeNav, setActiveNav] = useState<NavId>("Library");
  const [showFirstLaunchSetup, setShowFirstLaunchSetup] = useState(() => readString(storageKeys.setupComplete) !== "true");
  const [platformCapabilities, setPlatformCapabilities] = useState<PlatformCapabilities | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [showTofuManager, setShowTofuManager] = useState(false);
  const [editingGameId, setEditingGameId] = useState("");

  const notifications = useNotifications(behavior);
  const { notify } = notifications;
  const account = useAccount(notify);
  const { user } = account;
  const credentials = useCredentials(user, account.openSignIn);
  const sessions = useGameSessions();
  const { playtime, refreshPlaytime } = usePlaytime(sessions.sessions.length);
  const lib = useLibrary(playtime);
  const themeEngine = useThemeEngine();
  const actions = useGameActions({ lib, behavior, refreshPlaytime, refreshSessions: sessions.refresh, notify });
  const metadata = useMetadata({
    user, igdbConfigured: credentials.status.igdb, setLibrary: lib.setLibrary, notify,
    startProgress: notifications.startProgress, updateProgress: notifications.updateProgress,
  });
  const hasIgdb = Boolean(supabase && user && credentials.status.igdb);
  const add = useAddGame(lib, metadata, hasIgdb, credentials.status.igdb, actions.setLaunchError);
  const storage = useProfileStorage({
    user, library: lib.library, setLibrary: lib.setLibrary, behavior, setBehavior,
    notifications: notifications.notifications, setNotifications: notifications.setNotifications,
    theme: themeEngine.theme, themeIds: themeEngine.themes.map((option) => option.id), setTheme: themeEngine.setTheme,
    onProfileLoaded: (loaded) => {
      lib.setSelectedPikoId(loaded[0]?.id || "");
      lib.setSelectedTofuId(loaded[0]?.tofus?.[0]?.id || "");
      lib.setGameDetailsId("");
      notifications.setShowNotifications(false);
    },
  });
  const cloud = useCloudSync(user, lib.library, lib.setLibrary, storage.ready, storage.ownerKey);
  const downloads = useDownloads(activeNav === "Downloads", notify);

  useEffect(() => { void listRuntimes().then(setRuntimes).catch(() => {}); }, []);
  useEffect(() => {
    void getPlatformCapabilities().then(setPlatformCapabilities).catch((error) => console.warn("Mochi platform capabilities unavailable", error));
  }, []);
  useEffect(() => {
    void invoke("set_launch_on_startup", { enabled: behavior.launchOnStartup }).catch(() => { /* browser/development mode */ });
  }, [behavior.launchOnStartup]);

  useDeepLinks(account, (gameId) => {
    const game = lib.library.find((piko) => piko.id === gameId);
    if (!game) { actions.setLaunchError("That game is not in your Mochi library."); return; }
    lib.selectPiko(game);
    void actions.launchGame(game);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const finishFirstLaunchSetup = (games: ImportedGame[], sources: ImportSourceId[]) => {
    writeString(storageKeys.setupComplete, "true");
    writeJson(storageKeys.importSources, sources);
    setShowFirstLaunchSetup(false);
    if (games.length) add.importGames(games);
  };

  const chooseConfigLocation = async () => {
    try {
      const selected = await openDialog({ title: "Choose Mochi data folder", directory: true, multiple: false });
      if (typeof selected !== "string" || !selected) return;
      await invoke("move_mochi_config", { destination: selected });
      actions.setLaunchError("");
      window.dispatchEvent(new Event("mochi-config-changed"));
      await themeEngine.reloadThemes();
    } catch (error) {
      actions.setLaunchError(error instanceof Error ? error.message : String(error));
    }
  };

  const resetLocalData = async () => {
    if (!window.confirm("Clear all Mochi app data and return to the welcome screen? Your Mochi account will not be deleted.")) return;
    try { window.localStorage.clear(); } catch { /* storage unavailable */ }
    if (supabase) await supabase.auth.signOut({ scope: "local" });
    try { await invoke("clear_mochi_app_data"); } catch { /* browser/development mode */ }
    window.location.reload();
  };

  return {
    behavior, setBehavior, activeNav, setActiveNav, showFirstLaunchSetup, finishFirstLaunchSetup,
    platformCapabilities, runtimes, showTofuManager, setShowTofuManager, editingGameId, setEditingGameId,
    notifications, account, credentials, sessions, playtime, refreshPlaytime, lib, themeEngine, actions, metadata, add, storage, cloud, downloads,
    hasIgdb, chooseConfigLocation, resetLocalData,
  };
}

export type AppController = ReturnType<typeof useAppController>;

const AppContext = createContext<AppController | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const controller = useAppController();
  return <AppContext.Provider value={controller}>{children}</AppContext.Provider>;
}

export function useApp(): AppController {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}
