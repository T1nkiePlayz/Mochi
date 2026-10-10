import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { supabase } from "../lib/supabase";
import { useGameSessions } from "../hooks";
import { useSaveBackupOnExit } from "./useSaveBackupOnExit";
import { useQuickExitHints } from "./useQuickExitHints";
import { useDownloadPacing } from "./useDownloadPacing";
import { useGameTheme } from "./useGameTheme";
import { useScheduledBackup } from "./useScheduledBackup";
import { useThemeEngine } from "../lib/theme";
import { getPlatformCapabilities, listRuntimes, type PlatformCapabilities, type RuntimeInfo } from "../lib/platform";
import type { ImportedGame, ImportSourceId } from "../lib/sources";
import type { MinecraftMode } from "../lib/minecraftCopy";
import { discardPendingWrites, readJson, readString, storageKeys, writeJson, writeString } from "../lib/storage";
import { normalizeBehavior, type Behavior } from "./settings";
import { useNotifications } from "./useNotifications";
import { useAccount } from "./useAccount";
import { useCredentials } from "./useCredentials";
import { useLibrary } from "./useLibrary";
import { usePlaytime } from "./usePlaytime";
import { useCollections } from "./useCollections";
import { useGameNewsPoller } from "./useGameNewsPoller";
import { useProfileStorage } from "./useProfileStorage";
import { useCloudSync } from "./useCloudSync";
import { useDownloads } from "./useDownloads";
import { useMetadata } from "./useMetadata";
import { useInstancePacks } from "./useInstancePacks";
import { useAddGame } from "./useAddGame";
import { useGameActions } from "./useGameActions";
import { useDeepLinks } from "./useDeepLinks";
import { useCliIntents } from "./useCliIntents";
import { useLibraryIndex } from "./useLibraryIndex";
import { useDeals } from "./useDeals";
import { useLibraryWatcher } from "./useLibraryWatcher";
import { checkAccountPin } from "../lib/accountPin";
import { usePlayLimits } from "./usePlayLimits";
import { useScreenshotNotifier } from "./useScreenshotNotifier";
import { CliChooser } from "../components/CliChooser";
import { AchievementWatcher } from "../components/stats/AchievementWatcher";
import { ConfirmHost } from "../components/ui/ConfirmHost";
import { PinHost } from "../components/ui/PinHost";
import { ConflictPromptHost } from "../components/mods/ConflictPromptHost";
import { SelfInstallPrompt } from "../components/SelfInstallPrompt";
import { confirmAction } from "../lib/confirm";

export type NavId = "Library" | "Installed" | "Discover" | "Downloads" | "Stats" | "Deals" | "Settings";

function useAppController() {
  // Read synchronously: effects (launch on startup, Big Picture on startup) must never see defaults first.
  const [behavior, setBehavior] = useState<Behavior>(() => normalizeBehavior(readJson(storageKeys.settings, {})));
  const [activeNav, setActiveNav] = useState<NavId>("Library");
  const [showFirstLaunchSetup, setShowFirstLaunchSetup] = useState(() => readString(storageKeys.setupComplete) !== "true");
  const [platformCapabilities, setPlatformCapabilities] = useState<PlatformCapabilities | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [showTofuManager, setShowTofuManager] = useState(false);
  const [editingGameId, setEditingGameId] = useState("");

  // The Deals tab is optional: turning it off while it is open returns to the library.
  useEffect(() => { if (!behavior.showDeals) setActiveNav((current) => (current === "Deals" ? "Library" : current)); }, [behavior.showDeals]);
  const notifications = useNotifications(behavior);
  const { notify } = notifications;
  const behaviorRef = useRef(behavior);
  behaviorRef.current = behavior;
  const account = useAccount(notify, (saved) => behaviorRef.current.accountPins ? checkAccountPin(saved.id, saved.username) : Promise.resolve(true));
  const { user } = account;
  const credentials = useCredentials(user, account.openSignIn);
  const sessions = useGameSessions();
  const { playtime, refreshPlaytime } = usePlaytime(sessions.sessions.length);
  const lib = useLibrary(playtime, sessions.isRunning);
  useSaveBackupOnExit(sessions.running, lib.library, notify);
  useQuickExitHints(sessions.sessions, lib.library, notify);
  usePlayLimits(behavior.playLimits, sessions.sessions, lib.library, notify);
  useScreenshotNotifier(behavior.screenshotNotices, sessions.running, lib.library, behavior.screenshotFolders, notify);
  useGameTheme(behavior.gameThemes && activeNav === "Library", lib.library.find((piko) => piko.id === lib.gameDetailsId));
  const themeEngine = useThemeEngine();
  const actions = useGameActions({ lib, behavior, refreshPlaytime, refreshSessions: sessions.refresh, notify });
  const metadata = useMetadata({
    user, igdbConfigured: credentials.status.igdb, steamGridDbConfigured: credentials.status.steamgriddb,
    provider: behavior.metadataProvider, setLibrary: lib.setLibrary, notify,
    startProgress: notifications.startProgress, updateProgress: notifications.updateProgress,
  });
  const hasIgdb = Boolean(supabase && user && credentials.status.igdb);
  const add = useAddGame(lib, metadata, hasIgdb, credentials.status.igdb, actions.setLaunchError, () => setActiveNav("Library"), notifications);
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
  useGameNewsPoller(behavior.gameNews, lib.library, notify);
  useScheduledBackup(storage.ready, notify);
  useLibraryWatcher(behavior.watchFolders, storage.ready, lib.library, notify);
  const collections = useCollections(storage.ownerKey, storage.ready, lib.setLibrary);
  const cloud = useCloudSync(user, lib.library, lib.setLibrary, storage.ready, storage.ownerKey);
  const downloads = useDownloads(activeNav === "Downloads", notify);
  const downloadPacing = useDownloadPacing();
  useInstancePacks({ ready: storage.ready, library: lib.library, setLibrary: lib.setLibrary, sources: behavior.modSources });

  useEffect(() => { void listRuntimes().then(setRuntimes).catch(() => {}); }, []);
  useEffect(() => {
    void getPlatformCapabilities().then(setPlatformCapabilities).catch((error) => console.warn("Mochi platform capabilities unavailable", error));
  }, []);
  useEffect(() => {
    void invoke("set_launch_on_startup", { enabled: behavior.launchOnStartup }).catch(() => { /* browser/development mode */ });
  }, [behavior.launchOnStartup]);

  // mochi launch|open <game> and mochi:// links: resolved against the live library, launched through the normal path.
  const cliIntents = useCliIntents({
    ready: storage.ready, library: lib.library,
    launch: (game) => { lib.selectPiko(game); void actions.launchGame(game); },
    open: (game) => { lib.selectPiko(game); lib.setGameDetailsId(game.id); setActiveNav("Library"); },
    report: actions.setLaunchError,
  });
  useDeepLinks(account, cliIntents.handle);
  useLibraryIndex(lib.library, storage.ready);
  const deals = useDeals(behavior.showDeals, lib.library, notify);

  const finishFirstLaunchSetup = (games: ImportedGame[], sources: ImportSourceId[], minecraftMode: MinecraftMode = "copy") => {
    writeString(storageKeys.setupComplete, "true");
    writeJson(storageKeys.importSources, sources);
    setShowFirstLaunchSetup(false);
    if (games.length) add.importGames(games, { minecraftMode });
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
    notifications, account, credentials, sessions, playtime, refreshPlaytime, lib, collections, themeEngine, actions, metadata, add, storage, cloud, downloads, downloadPacing,
    hasIgdb, chooseConfigLocation, resetLocalData, cliIntents, deals,
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
  return <AppStoreProvider controller={controller}><AppContext.Provider value={controller}><AchievementWatcher />{children}<ConfirmHost /><PinHost /><ConflictPromptHost /><SelfInstallPrompt />{controller.cliIntents.choice && <CliChooser {...controller.cliIntents.choice} onPick={controller.cliIntents.pick} onClose={controller.cliIntents.closeChoice} />}</AppContext.Provider></AppStoreProvider>;
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
