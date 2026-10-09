import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { supabase } from "../lib/supabase";
import { useGameSessions } from "../hooks";
import { useThemeEngine } from "../lib/theme";
import { getPlatformCapabilities, listRuntimes, type PlatformCapabilities, type RuntimeInfo } from "../lib/platform";
import type { ImportedGame, ImportSourceId } from "../lib/sources";
import { discardPendingWrites, readJson, readString, storageKeys, writeJson, writeString } from "../lib/storage";
import { normalizeBehavior, type Behavior } from "./settings";
import { useNotifications } from "./useNotifications";
import { useAccount } from "./useAccount";
import { useCredentials } from "./useCredentials";
import { useLibrary } from "./useLibrary";
import { usePlaytime } from "./usePlaytime";
import { useCollections } from "./useCollections";
import { useProfileStorage } from "./useProfileStorage";
import { useCloudSync } from "./useCloudSync";
import { useDownloads } from "./useDownloads";
import { useMetadata } from "./useMetadata";
import { useAddGame } from "./useAddGame";
import { useGameActions } from "./useGameActions";
import { useDeepLinks } from "./useDeepLinks";
import { AchievementWatcher } from "../components/stats/AchievementWatcher";
import { ConfirmHost } from "../components/ui/ConfirmHost";
import { SelfInstallPrompt } from "../components/SelfInstallPrompt";
import { confirmAction } from "../lib/confirm";

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
  const lib = useLibrary(playtime, sessions.isRunning);
  const themeEngine = useThemeEngine();
  const actions = useGameActions({ lib, behavior, refreshPlaytime, refreshSessions: sessions.refresh, notify });
  const metadata = useMetadata({
    user, igdbConfigured: credentials.status.igdb, steamGridDbConfigured: credentials.status.steamgriddb,
    provider: behavior.metadataProvider, setLibrary: lib.setLibrary, notify,
    startProgress: notifications.startProgress, updateProgress: notifications.updateProgress,
  });
  const hasIgdb = Boolean(supabase && user && credentials.status.igdb);
  const add = useAddGame(lib, metadata, hasIgdb, credentials.status.igdb, actions.setLaunchError, () => setActiveNav("Library"));
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
  const collections = useCollections(storage.ownerKey, storage.ready, lib.setLibrary);
  const cloud = useCloudSync(user, lib.library, lib.setLibrary, storage.ready, storage.ownerKey);
  const downloads = useDownloads(activeNav === "Downloads", notify);

  useEffect(() => { void listRuntimes().then(setRuntimes).catch(() => {}); }, []);
  useEffect(() => {
    void getPlatformCapabilities().then(setPlatformCapabilities).catch((error) => console.warn("Mochi platform capabilities unavailable", error));
  }, []);
  useEffect(() => {
    void invoke("set_launch_on_startup", { enabled: behavior.launchOnStartup }).catch(() => { /* browser/development mode */ });
  }, [behavior.launchOnStartup]);

  // A launch link that arrives before the (per-account) library has loaded waits instead of reporting "not found".
  const pendingLaunch = useRef("");
  const launchFromLink = (gameId: string) => {
    if (!storage.ready) { pendingLaunch.current = gameId; return; }
    const game = lib.library.find((piko) => piko.id === gameId);
    if (!game) { actions.setLaunchError("That game is not in your Mochi library."); return; }
    lib.selectPiko(game);
    void actions.launchGame(game);
  };
  useDeepLinks(account, launchFromLink);
  useEffect(() => {
    if (!storage.ready || !pendingLaunch.current) return;
    const gameId = pendingLaunch.current;
    pendingLaunch.current = "";
    launchFromLink(gameId);
  }, [storage.ready]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!await confirmAction({
      title: "Clear all Mochi app data?", danger: true, confirmLabel: "Clear everything",
      message: "Mochi returns to the welcome screen on this device. Your Mochi account and your installed games are not deleted.",
      items: ["Your library, collections, tags and favourites on this device", "Settings, themes choice and notifications", "Saved achievements, playtime cache and downloaded artwork", "Signed-in sessions on this device"],
    })) return;
    discardPendingWrites();
    try { window.localStorage.clear(); } catch { /* storage unavailable */ }
    try {
      if (supabase) await supabase.auth.signOut({ scope: "local" });
      await invoke("clear_mochi_app_data");
    } catch { /* browser/development mode, or already signed out */ }
    window.location.reload();
  };

  return {
    behavior, setBehavior, activeNav, setActiveNav, showFirstLaunchSetup, finishFirstLaunchSetup,
    platformCapabilities, runtimes, showTofuManager, setShowTofuManager, editingGameId, setEditingGameId,
    notifications, account, credentials, sessions, playtime, refreshPlaytime, lib, collections, themeEngine, actions, metadata, add, storage, cloud, downloads,
    hasIgdb, chooseConfigLocation, resetLocalData,
  };
}

export type AppController = ReturnType<typeof useAppController>;

const AppContext = createContext<AppController | null>(null);

/** External store mirroring the controller, so chrome can subscribe to slices instead of re-rendering on every change. */
type AppStore = { current: AppController; listeners: Set<() => void> };
const AppStoreContext = createContext<AppStore | null>(null);

/** Mirrors `controller` into the store and notifies selector subscribers after each commit where it changed. */
export function AppStoreProvider({ controller, children }: { controller: AppController; children: ReactNode }) {
  const store = useRef<AppStore | null>(null);
  // Populated synchronously on first render so selector consumers can read it before any effect runs.
  if (!store.current) store.current = { current: controller, listeners: new Set() };
  useLayoutEffect(() => {
    const current = store.current!;
    if (current.current === controller) return;
    current.current = controller;
    current.listeners.forEach((listener) => listener());
  });
  return <AppStoreContext.Provider value={store.current}>{children}</AppStoreContext.Provider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const controller = useAppController();
  return <AppStoreProvider controller={controller}><AppContext.Provider value={controller}><AchievementWatcher />{children}<ConfirmHost /><SelfInstallPrompt /></AppContext.Provider></AppStoreProvider>;
}

export function useApp(): AppController {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function useAppStore(): AppStore {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("useAppSelector must be used inside <AppProvider>");
  return store;
}

/** Re-renders only when the selected value changes (per `isEqual`). Select primitives or stable objects; use `shallowEqual` for small fresh objects. */
export function useAppSelector<T>(selector: (app: AppController) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const store = useAppStore();
  const last = useRef<{ source: AppController; value: T } | null>(null);
  const subscribe = useCallback((listener: () => void) => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; }, [store]);
  const getSnapshot = () => {
    const source = store.current;
    const previous = last.current;
    if (previous && previous.source === source) return previous.value;
    const value = selector(source);
    if (previous && isEqual(previous.value, value)) { last.current = { source, value: previous.value }; return previous.value; }
    last.current = { source, value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Stable accessor for the latest controller, for event handlers that need functions whose identity changes every render. */
export function useAppGetter(): () => AppController {
  const store = useAppStore();
  return useCallback(() => store.current, [store]);
}
