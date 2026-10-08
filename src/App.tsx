import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import {
  Bell,
  ChevronDown,
  Cloud,
  Download,
  Gamepad2,
  Grid2X2,
  Library,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  WifiOff,
  X,
  Palette,
  FileJson,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  KeyRound,
  Github,
  Unlink,
} from "lucide-react";

function GoogleIcon({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.71-.06-1.39-.18-2.04H12v3.86h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.21Z"/><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.93-3.31.93-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.6Z"/><path fill="#FBBC05" d="M6.54 13.69A5.84 5.84 0 0 1 6.23 12c0-.59.11-1.16.31-1.69V7.78H3.3A9.72 9.72 0 0 0 2.27 12c0 1.57.38 3.05 1.03 4.22l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.28c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.83 3.3 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.7 5.38l3.24 2.53C7.31 8 9.46 6.28 12 6.28Z"/></svg>;
}
import { AccountAvatar } from "./components/AccountAvatar";
import { GameArtwork } from "./components/GameArtwork";
import { GameDetails } from "./components/GameDetails";
import { LibraryModSearch } from "./components/LibraryModSearch";
import { ModrinthManager } from "./components/ModrinthManager";
import { ModrinthDiscover } from "./components/ModrinthDiscover";
import { MochiIcon } from "./components/MochiIcon";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FirstLaunchSetup } from "./components/FirstLaunchSetup";
import { ImportPicker } from "./components/ImportPicker";
import type { ImportedGame, ImportSourceId } from "./lib/sources";
import { isCloudConfigured, supabase } from "./lib/supabase";
import { clearAccountCloudData, getCloudAccountSettings, pullLibrary, pushLibrary } from "./lib/cloud";
import type { Piko, Tofu } from "./models";
import { lookupIgdbGame, lookupIgdbGames, type IgdbGame, type IgdbSettings } from "./lib/igdb";
import {
  chooseGameAppBundle,
  chooseGameTarget,
  getPlatformCapabilities,
  listInstalledFlatpaks,
  normalizeLaunchTarget,
  type FlatpakApp,
  type LaunchMethodId,
  type PlatformCapabilities,
} from "./lib/platform";
import { deletePasskey, enrollTotp, getVerifiedTotpFactor, linkAuthIdentity, listPasskeys, registerPasskey, removeTotp, sendEmailCode, signInWithProvider, verifyEmailCode, verifyEmailToken, verifyMfaCode } from "./lib/auth";
import { importThemeFile, importThemeFolder, useThemeEngine } from "./lib/theme";
import { getProviderCredentialStatus, saveProviderCredential, validateNexusApiKey } from "./lib/providerCredentials";
import { getDownloads } from "./lib/modrinth";
import { invoke } from "@tauri-apps/api/core";

const navItems = [
  { label: "Library", icon: Library },
  { label: "Installed", icon: Grid2X2 },
  { label: "Discover", icon: Sparkles },
  { label: "Downloads", icon: Download },
];

const storedPikosKey = "mochi:pikos";
const storedSettingsKey = "mochi:settings";
const setupCompleteKey = "mochi:setup-complete";
const importSourcesKey = "mochi:import-sources";
const igdbCacheKey = (userId?: string) => `mochi:igdb-cache:${userId || "local"}`;
const profileStorageKey = (userId: string, key: string) => `mochi:profile:${userId}:${key}`;
function gameSearchMatches(query: string, candidate: string): boolean {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const needle = normalize(query);
  const haystack = normalize(candidate);
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  const words = haystack.split(/\s+/);
  const distance = (left: string, right: string) => {
    let row = Array.from({ length: right.length + 1 }, (_v, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
      const next = [i];
      for (let j = 1; j <= right.length; j += 1) next[j] = Math.min(next[j-1] + 1, row[j] + 1, row[j-1] + (left[i-1] === right[j-1] ? 0 : 1));
      row = next;
    }
    return row[right.length];
  };
  return needle.split(/\s+/).every((word) => words.some((candidateWord) => {
    if (candidateWord.includes(word) || word.includes(candidateWord)) return Math.min(candidateWord.length, word.length) >= 3;
    const threshold = Math.min(candidateWord.length, word.length) >= 9 ? 2 : 1;
    return Math.min(candidateWord.length, word.length) >= 4 && Math.abs(candidateWord.length - word.length) <= threshold && distance(word, candidateWord) <= threshold;
  }));
}
function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KiB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MiB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GiB";
}

function App() {
  const [library, setLibrary] = useState<Piko[]>(() => {
    try {
      const stored = window.localStorage.getItem(storedPikosKey);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? (parsed as Piko[]) : [];
    } catch {
      return [];
    }
  });
  const [activeNav, setActiveNav] = useState("Library");
  const [selectedPikoId, setSelectedPikoId] = useState("");
  const [selectedTofuId, setSelectedTofuId] = useState("");
  const [search, setSearch] = useState("");
  const [gameDetailsId, setGameDetailsId] = useState("");
  const [showAddPiko, setShowAddPiko] = useState(false);
  const [showNewTofu, setShowNewTofu] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<Array<{ id: string; username: string; email: string; refreshToken: string; avatarUrl?: string }>>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("mochi:accounts") || "[]") as Array<{ id: string; username: string; email: string; refreshToken: string; avatarUrl?: string }>;
      return stored.slice(0, 5).map((account) => ({
        ...account,
        username: account.username.includes("@") ? account.username.split("@")[0] : account.username,
      }));
    } catch {
      return [];
    }
  });
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string; createdAt: number; progress?: { value: number; total: number } }>>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCustomGame, setShowCustomGame] = useState(false);
  const [addGameStep, setAddGameStep] = useState<"form" | "igdb">("form");
  const [pendingGame, setPendingGame] = useState<{ name: string; executablePath: string; platformCategory: string; candidates: IgdbGame[] } | null>(null);
  const [platformCategory, setPlatformCategory] = useState("Custom");
  const [launchType, setLaunchType] = useState<LaunchMethodId>("file");
  const [launchTarget, setLaunchTarget] = useState("");
  const [platformCapabilities, setPlatformCapabilities] = useState<PlatformCapabilities | null>(null);
  const [flatpakPickerOpen, setFlatpakPickerOpen] = useState(false);
  const [flatpaks, setFlatpaks] = useState<FlatpakApp[]>([]);
  const [flatpakBusy, setFlatpakBusy] = useState(false);
  const [settings, setSettings] = useState<IgdbSettings>({ clientId: "", clientSecret: "" });
  const [behavior, setBehavior] = useState(() => {
    try { const stored = JSON.parse(window.localStorage.getItem(storedSettingsKey) || "{}"); return { launchOnStartup: Boolean(stored.launchOnStartup), keepOpen: stored.keepOpen !== false, confirmLaunch: stored.confirmLaunch !== false, detailedErrors: Boolean(stored.detailedErrors), experimentalFeatures: Boolean(stored.experimentalFeatures), notificationsEnabled: stored.notificationsEnabled !== false, inAppNotifications: stored.inAppNotifications !== false, systemNotifications: stored.systemNotifications !== false }; } catch { return { launchOnStartup: false, keepOpen: true, confirmLaunch: true, detailedErrors: false, experimentalFeatures: false, notificationsEnabled: true, inAppNotifications: true, systemNotifications: true }; }
  });
  const [multipleAccountsEnabled, setMultipleAccountsEnabled] = useState(() => { try { return JSON.parse(window.localStorage.getItem(storedSettingsKey) || "{}").multipleAccountsEnabled === true; } catch { return false; } });
  const [accountStorageOwner, setAccountStorageOwner] = useState("uninitialized");
  const [igdbRefreshBusy, setIgdbRefreshBusy] = useState(false);
  const [igdbMessage, setIgdbMessage] = useState("");
  const [nexusApiKey, setNexusApiKey] = useState("");
  const [credentialStatus, setCredentialStatus] = useState({ igdb: false, nexus: false });
  const [credentialStatusLoaded, setCredentialStatusLoaded] = useState(false);
  const [igdbClientId, setIgdbClientId] = useState("");
  const [igdbClientSecret, setIgdbClientSecret] = useState("");
  const [credentialBusy, setCredentialBusy] = useState<"igdb" | "nexus" | null>(null);
  const [igdbBusy, setIgdbBusy] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaFactorId, setMfaFactorId] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [securityFactors, setSecurityFactors] = useState<any[]>([]);
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [emailCodeStep, setEmailCodeStep] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeEmail, setEmailCodeEmail] = useState("");
  const [showFirstLaunchSetup, setShowFirstLaunchSetup] = useState(() => window.localStorage.getItem(setupCompleteKey) !== "true");
  const [showImportPicker, setShowImportPicker] = useState(false);
  const [playtime, setPlaytime] = useState<Array<{ gameId: string; name: string; seconds: number; lastPlayed: number }>>([]);
  const [downloads, setDownloads] = useState<Array<{ id: string; tofuId: string; tofuName: string; itemName: string; filename: string; downloaded: number; total?: number; status: "downloading" | "completed" | "failed"; error?: string; createdAt: number; finishedAt?: number }>>([]);
  const [syncState, setSyncState] = useState<"offline" | "syncing" | "synced" | "error">(
    isCloudConfigured ? "offline" : "offline",
  );
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudDataAccessAllowed, setCloudDataAccessAllowed] = useState(false);
  const [cloudDataBusy, setCloudDataBusy] = useState(false);
  const [cloudDataMessage, setCloudDataMessage] = useState("");
  const syncInitialized = useRef(false);
  const { themes, theme, setTheme, reloadThemes, configInfo } = useThemeEngine();
  const currentUsername = user?.user_metadata?.username
    || user?.user_metadata?.user_name
    || user?.user_metadata?.preferred_username
    || (user?.email ? user.email.split("@")[0] : null)
    || "Guest";
  const greeting = (() => { const hour = new Date().getHours(); return hour < 5 || hour >= 18 ? "Good evening" : hour < 12 ? "Good morning" : "Good afternoon"; })();
  const activeProfileId = user?.id || "guest";
  const accountStorageOwnerKey = multipleAccountsEnabled ? `profiles:${activeProfileId}` : "shared";
  const scopedStorageKey = (key: string) => multipleAccountsEnabled ? profileStorageKey(activeProfileId, key) : key;
  const pushNotification = (title: string, message: string) => {
    const notification = { id: crypto.randomUUID(), title, message, createdAt: Date.now() };
    if (behavior.notificationsEnabled && behavior.inAppNotifications) setNotifications((current) => [notification, ...current].slice(0, 20));
    if (behavior.notificationsEnabled && behavior.systemNotifications) void invoke("send_system_notification", { title, body: message }).catch(() => {});
  };
  const updateNotificationProgress = (id: string, progress: { value: number; total: number }, message: string) => {
    setNotifications(current => current.map(item => item.id === id ? { ...item, message, progress } : item));
  };
  const saveAccountSession = (sessionUser: User, refreshToken: string) => {
    const username = sessionUser.user_metadata?.username
      || sessionUser.user_metadata?.user_name
      || sessionUser.user_metadata?.preferred_username
      || (sessionUser.email ? sessionUser.email.split("@")[0] : "Guest");
    const account = { id: sessionUser.id, username, email: sessionUser.email || "", refreshToken, avatarUrl: typeof sessionUser.user_metadata?.avatar_url === "string" ? sessionUser.user_metadata.avatar_url : typeof sessionUser.user_metadata?.picture === "string" ? sessionUser.user_metadata.picture : undefined };
    setSavedAccounts((current) => { const next = [account, ...current.filter((item) => item.id !== account.id)].slice(0, 5); window.localStorage.setItem("mochi:accounts", JSON.stringify(next)); return next; });
  };
  const addAccount = () => { setShowAccountMenu(false); setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); };

  const setMultipleAccountProfiles = (enabled: boolean) => {
    if (enabled) {
      window.localStorage.setItem(profileStorageKey(activeProfileId, "pikos"), JSON.stringify(library));
      window.localStorage.setItem(profileStorageKey(activeProfileId, "settings"), JSON.stringify({ ...behavior, theme }));
      window.localStorage.setItem(profileStorageKey(activeProfileId, "notifications"), JSON.stringify(notifications));
    } else {
      window.localStorage.setItem(storedPikosKey, JSON.stringify(library));
      window.localStorage.setItem(storedSettingsKey, JSON.stringify({ ...behavior, multipleAccountsEnabled: false }));
      window.localStorage.setItem("mochi:notifications", JSON.stringify(notifications));
    }
    setMultipleAccountsEnabled(enabled);
  };

  const switchAccount = async (account: { id: string; username: string; email: string; refreshToken: string; avatarUrl?: string }) => {
    if (!supabase || account.id === user?.id) { setShowAccountMenu(false); return; }
    setAuthBusy(true);
    try {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: account.refreshToken });
      if (error || !data.session) throw error ?? new Error("Unable to restore this saved account.");
      if (data.session.refresh_token) {
        saveAccountSession(data.session.user, data.session.refresh_token);
      }
      setShowAccountMenu(false);
      pushNotification("Account switched", "Now using " + account.username + ".");
    } catch (error) {
      setSavedAccounts((current) => {
        const next = current.filter((item) => item.id !== account.id);
        window.localStorage.setItem("mochi:accounts", JSON.stringify(next));
        return next;
      });
      setAuthError(error instanceof Error ? error.message : "Unable to switch accounts. Please sign in again.");
      setShowAccountMenu(false);
      setShowAuth(true);
    } finally { setAuthBusy(false); }
  };

  const chooseMochiConfigLocation = async () => {
    try {
      const selected = await openDialog({ title: "Choose Mochi data folder", directory: true, multiple: false });
      if (typeof selected !== "string" || !selected) return;
      await invoke("move_mochi_config", { destination: selected });
      const info = await invoke<{ configPath: string; themesPath: string; selectedTheme: string }>("get_mochi_config_info");
      setLaunchError("");
      window.dispatchEvent(new Event("mochi-config-changed"));
      void info;
      await reloadThemes();
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (accountStorageOwner !== accountStorageOwnerKey) return;
    window.localStorage.setItem(scopedStorageKey("pikos"), JSON.stringify(library));
  }, [library, accountStorageOwner, accountStorageOwnerKey]);

  useEffect(() => {
    void refreshPlaytime();
    const timer = window.setInterval(() => void refreshPlaytime(), 10000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (accountStorageOwner !== accountStorageOwnerKey) return;
    if (multipleAccountsEnabled) window.localStorage.setItem(scopedStorageKey("settings"), JSON.stringify({ ...behavior, theme }));
    else window.localStorage.setItem(storedSettingsKey, JSON.stringify({ ...behavior, multipleAccountsEnabled }));
  }, [behavior, theme, multipleAccountsEnabled, accountStorageOwner, accountStorageOwnerKey]);

  useEffect(() => {
    try {
      const globalSettings = JSON.parse(window.localStorage.getItem(storedSettingsKey) || "{}");
      if (globalSettings.multipleAccountsEnabled !== multipleAccountsEnabled) {
        window.localStorage.setItem(storedSettingsKey, JSON.stringify({ ...globalSettings, multipleAccountsEnabled }));
      }
    } catch { /* Recover from malformed local settings on the next save. */ }
  }, [multipleAccountsEnabled]);

  useEffect(() => {
    if (accountStorageOwner !== accountStorageOwnerKey) return;
    window.localStorage.setItem(scopedStorageKey("notifications"), JSON.stringify(notifications));
  }, [notifications, multipleAccountsEnabled, accountStorageOwner, accountStorageOwnerKey]);

  useEffect(() => {
    void invoke("set_launch_on_startup", { enabled: behavior.launchOnStartup }).catch(() => { /* browser/development mode */ });
  }, [behavior.launchOnStartup]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    let unlisten: (() => void) | undefined;

    const handleDeepLinks = (urls: string[]) => {
      const callbackUrl = urls.find((url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === "mochi:" && parsed.hostname === "auth" && parsed.pathname === "/callback";
        } catch { return false; }
      });
      if (callbackUrl) {
        const parsed = new URL(callbackUrl);
        const accessToken = parsed.searchParams.get("access_token");
        const refreshToken = parsed.searchParams.get("refresh_token");
        if (accessToken && refreshToken) {
          // Any web page or app can open mochi:// links, so never switch accounts silently:
          // a crafted link could otherwise sign this device into an attacker's account.
          if (!window.confirm("Finish signing in to Mochi with the account from this browser link?")) return;
          setShowAuth(true);
          setAuthBusy(true);
          setAuthError("");
          setAuthNotice("Completing browser sign-in…");
          void client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
            .then(({ error }) => {
              if (error) throw error;
              setAuthNotice("Signed in successfully.");
              setShowAuth(false);
            })
            .catch((error) => setAuthError(error instanceof Error ? error.message : "Unable to complete browser sign-in."))
            .finally(() => setAuthBusy(false));
          return;
        }
      }

      const verificationUrl = urls.find((url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === "mochi:" && parsed.hostname === "auth" && parsed.pathname === "/verify";
        } catch {
          return false;
        }
      });
      if (!verificationUrl) return;

      setShowAuth(true);
      setAuthBusy(true);
      setAuthError("");
      setAuthNotice("Verifying your email with Mochi…");

      void verifyEmailToken(client, verificationUrl)
        .then(() => {
          setAuthNotice("Email verified successfully. Your Mochi account is ready.");
        })
        .catch((error) => {
          setAuthError(error instanceof Error ? error.message : "Email verification failed.");
          setAuthNotice("");
        })
        .finally(() => setAuthBusy(false));
    };

    void getCurrent()
      .then((urls) => {
        if (urls) handleDeepLinks(urls);
      })
      .catch((error) => {
        console.warn("Mochi deep-link startup check failed", error);
      });

    void onOpenUrl((urls) => handleDeepLinks(urls))
      .then((removeListener) => {
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Mochi deep-link listener failed", error);
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); if (data.session?.user && data.session.refresh_token) saveAccountSession(data.session.user, data.session.refresh_token); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { setUser(session?.user ?? null); if (session?.user && session.refresh_token) saveAccountSession(session.user, session.refresh_token); });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (accountStorageOwner === accountStorageOwnerKey) return;
    const profileKey = (key: string) => multipleAccountsEnabled ? profileStorageKey(activeProfileId, key) : key;
    const read = <T,>(key: string, fallback: T): T => {
      try { const value = window.localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
    };
    const fallbackSettings = { launchOnStartup: false, keepOpen: true, confirmLaunch: true, detailedErrors: false, experimentalFeatures: false, notificationsEnabled: true, inAppNotifications: true, systemNotifications: true };
    const nextLibrary = read<Piko[]>(profileKey("pikos"), multipleAccountsEnabled && user ? [] : read<Piko[]>(storedPikosKey, []));
    const nextSettings = read<Record<string, unknown>>(profileKey("settings"), multipleAccountsEnabled && user ? fallbackSettings : read<Record<string, unknown>>(storedSettingsKey, fallbackSettings));
    const nextNotifications = read<Array<{ id: string; title: string; message: string; createdAt: number; progress?: { value: number; total: number } }>>(profileKey("notifications"), multipleAccountsEnabled && user ? [] : read("mochi:notifications", []));
    setLibrary(nextLibrary);
    setBehavior({
      launchOnStartup: Boolean(nextSettings.launchOnStartup), keepOpen: nextSettings.keepOpen !== false,
      confirmLaunch: nextSettings.confirmLaunch !== false, detailedErrors: Boolean(nextSettings.detailedErrors),
      experimentalFeatures: Boolean(nextSettings.experimentalFeatures), notificationsEnabled: nextSettings.notificationsEnabled !== false,
      inAppNotifications: nextSettings.inAppNotifications !== false, systemNotifications: nextSettings.systemNotifications !== false,
    });
    setNotifications(nextNotifications);
    setSelectedPikoId(nextLibrary[0]?.id || "");
    setSelectedTofuId(nextLibrary[0]?.tofus?.[0]?.id || "");
    setGameDetailsId("");
    setShowNotifications(false);
    if (multipleAccountsEnabled) void setTheme(typeof nextSettings.theme === "string" && themes.some(option => option.id === nextSettings.theme) ? nextSettings.theme : "mochi");
    setAccountStorageOwner(accountStorageOwnerKey);
  }, [user?.id, multipleAccountsEnabled, accountStorageOwner, accountStorageOwnerKey]);

  useEffect(() => {
    if (accountStorageOwner !== accountStorageOwnerKey) return;
    if (!supabase || !user) {
      syncInitialized.current = false;
      setCloudSyncEnabled(false);
      setCloudDataAccessAllowed(false);
      setSyncState("offline");
      return;
    }

    let cancelled = false;
    const client = supabase;
    setSyncState("syncing");
    void getCloudAccountSettings(client, user.id)
      .then(async (settings) => {
        if (cancelled) return;
        setCloudDataAccessAllowed(settings.metadataSyncAllowed);
        setCloudSyncEnabled(settings.syncEnabled);
        if (!settings.syncEnabled) {
          syncInitialized.current = false;
          setSyncState("offline");
          return;
        }
        const cloudLibrary = await pullLibrary(client, user.id);
        if (cancelled) return;
        if (cloudLibrary.length) {
          // Merge instead of replacing so games that only exist on this device are not lost.
          const cloudIds = new Set(cloudLibrary.map((piko) => piko.id));
          setLibrary([...cloudLibrary, ...library.filter((piko) => !cloudIds.has(piko.id))]);
        } else {
          await pushLibrary(client, user.id, library);
        }
        syncInitialized.current = true;
        setSyncState("synced");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Mochi cloud sync failed", error);
        syncInitialized.current = false;
        setCloudDataAccessAllowed(false);
        setCloudSyncEnabled(false);
        setSyncState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, accountStorageOwner, accountStorageOwnerKey]);

  useEffect(() => {
    if (accountStorageOwner !== accountStorageOwnerKey || !supabase || !user || !cloudSyncEnabled || !syncInitialized.current) return;
    const client = supabase;
    setSyncState("syncing");
    void pushLibrary(client, user.id, library)
      .then(() => setSyncState("synced"))
      .catch((error: unknown) => {
        console.error("Mochi cloud sync failed", error);
        setSyncState("error");
      });
  }, [library, user?.id, cloudSyncEnabled, accountStorageOwner, accountStorageOwnerKey]);

  const finishFirstLaunchSetup = (games: ImportedGame[], sources: ImportSourceId[]) => {
    window.localStorage.setItem(setupCompleteKey, "true");
    window.localStorage.setItem(importSourcesKey, JSON.stringify(sources));
    setShowFirstLaunchSetup(false);
    if (games.length) addImportedGames(games);
  };

  const selectedPiko = library.find((piko) => piko.id === selectedPikoId) ?? library[0] ?? {
    id: "__empty",
    name: "No Pikos yet",
    description: "Add a game to start building your library.",
    accent: "#a99ad6",
    artwork: "linear-gradient(145deg, rgba(73,57,103,.35), rgba(20,16,29,.96))",
    tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" as const }],
  };
  const selectedTofu = selectedPiko.tofus.find((tofu) => tofu.id === selectedTofuId) ?? selectedPiko.tofus[0];
  const visiblePikos = useMemo(() => {
    const query = search.trim();
    if (!query) return library;
    return library.filter((piko) => [piko.name, piko.description, piko.platformCategory || "", piko.sourceId || "", ...(piko.categories ?? [])].some((value) => gameSearchMatches(query, value)));
  }, [library, search]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);
  const groupedPikos = useMemo(() => {
    const groups = new Map<string, Piko[]>();
    visiblePikos.forEach((piko) => {
      const category = piko.platformCategory || "Other";
      groups.set(category, [...(groups.get(category) ?? []), piko]);
    });
    return [...groups.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [visiblePikos]);

  const selectPiko = (piko: Piko) => {
    setSelectedPikoId(piko.id);
    setSelectedTofuId(piko.tofus[0]?.id ?? "");
  };

  const updateSelectedTofu = (patch: Partial<Tofu>) => {
    setLibrary(current => current.map(piko => piko.id === selectedPiko.id ? { ...piko, tofus: piko.tofus.map(tofu => tofu.id === selectedTofu.id ? { ...tofu, ...patch } : tofu) } : piko));
  };

  const refreshPlaytime = async () => {
    try {
      const entries = await invoke<Array<{ gameId: string; name: string; seconds: number; lastPlayed: number }>>("get_playtime");
      setPlaytime(entries);
    } catch {
      // Browser/development mode or an older backend without the playtime service.
    }
  };

  const refreshDownloads = async () => {
    try {
      setDownloads(await getDownloads());
    } catch {
      // Browser/development mode or an older backend without the download service.
    }
  };

  const launchGame = async (piko: Piko = selectedPiko) => {
    if (piko.id === "__empty" || !piko.executablePath) {
      setLaunchError("This game does not have an executable path. Add or edit the game to set its executable.");
      return;
    }
    if (behavior.confirmLaunch && !window.confirm(`Launch ${piko.name}?`)) return;
    setLaunchError("");
    setIsLaunching(true);
    try {
      await invoke("launch_game_tracked", {
        gameId: piko.id,
        name: piko.name,
        launchTarget: piko.executablePath,
      });
      await refreshPlaytime();
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLaunching(false);
    }
  };

  const selectedPlaytime = playtime.find((entry) => entry.gameId === selectedPiko.id);
  const formatPlaytime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const addTofu = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const version = String(form.get("version") || "").trim();
    const runtime = String(form.get("runtime") || "").trim();
    if (!name || !version || !runtime) return;

    const tofu: Tofu = {
      id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      name,
      version,
      runtime,
      mods: 0,
      status: "Ready",
    };

    setLibrary((current) =>
      current.map((piko) => (piko.id === selectedPiko.id ? { ...piko, tofus: [...piko.tofus, tofu] } : piko)),
    );
    setSelectedTofuId(tofu.id);
    setShowNewTofu(false);
  };

  const loadFlatpaks = async () => {
    setFlatpakBusy(true);
    try {
      const installed = await listInstalledFlatpaks();
      setFlatpaks(installed);
      setFlatpakPickerOpen(true);
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setFlatpakBusy(false);
    }
  };

  const chooseGameFile = async () => {
    try {
      const selected = launchType === "app" ? await chooseGameAppBundle() : await chooseGameTarget();
      if (selected) setLaunchTarget(selected);
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void getPlatformCapabilities().then(setPlatformCapabilities).catch((error) => {
      console.warn("Mochi platform capabilities unavailable", error);
    });
  }, []);

  const resolveIgdbImage = (url?: string, size = "t_cover_big") => url ? (url.startsWith("//") ? `https:${url}` : url).replace(/t_[a-z0-9_]+(?=\/)/, size) : undefined;
  const applyIgdbMetadata = (piko: Piko, metadata: IgdbGame | null): Piko => {
    const artworkUrl = resolveIgdbImage(metadata?.cover?.url) || resolveIgdbImage(metadata?.artworks?.[0]?.url, "t_1080p");
    const screenshots = (metadata?.screenshots ?? []).map(item => resolveIgdbImage(item.url, "t_screenshot_big")).filter((url): url is string => Boolean(url)).slice(0, 8);
    return {
      ...piko,
      name: metadata?.name || piko.name,
      categories: metadata?.genres?.map((genre) => genre.name).filter(Boolean) ?? [],
      description: metadata?.summary?.trim() || piko.description,
      artworkUrl,
      artworkCacheKey: artworkUrl ? piko.artworkCacheKey || piko.id.replace(/[^a-zA-Z0-9_-]/g, "-") : undefined,
      artwork: artworkUrl ? `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), url('${artworkUrl}')` : piko.artwork,
      igdbId: metadata?.id,
      screenshots,
      trailerId: metadata?.videos?.find(video => video.video_id)?.video_id,
      firstReleaseDate: metadata?.first_release_date,
    };
  };
  const bestIgdbMatch = (name: string, games: IgdbGame[]) => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const expected = normalize(name);
    const distance = (left: string, right: string) => {
      let row = Array.from({ length: right.length + 1 }, (_v, index) => index);
      for (let i = 1; i <= left.length; i += 1) { const next = [i]; for (let j = 1; j <= right.length; j += 1) next[j] = Math.min(next[j-1] + 1, row[j] + 1, row[j-1] + (left[i-1] === right[j-1] ? 0 : 1)); row = next; }
      return row[right.length];
    };
    const ranked = games.map(game => ({ game, score: 1 - distance(expected, normalize(game.name)) / Math.max(expected.length, normalize(game.name).length, 1) })).sort((a,b)=>b.score-a.score);
    return ranked[0]?.score >= 0.88 ? ranked[0].game : null;
  };
  const cacheIgdbArtwork = async (piko: Piko) => {
    if (!piko.artworkUrl || !piko.artworkCacheKey) return;
    try { await invoke("cache_game_artwork", { url: piko.artworkUrl, cacheKey: piko.artworkCacheKey }); } catch { /* Keep the remote artwork URL as an offline fallback. */ }
  };
  const enrichImportedGames = async (games: Piko[]) => {
    if (!supabase || !user || !credentialStatus.igdb || !games.length) return;
    const client = supabase;
    const userId = user.id;
    const jobId = crypto.randomUUID();
    const notification = { id: jobId, title: "IGDB is updating your library", message: `Finding metadata for ${games.length} imported games…`, createdAt: Date.now(), progress: { value: 0, total: games.length } };
    if (behavior.notificationsEnabled && behavior.inAppNotifications) setNotifications(current => [notification, ...current].slice(0, 20));
    const cache: Record<string, IgdbGame | null> = (() => { try { return JSON.parse(window.localStorage.getItem(igdbCacheKey(user.id)) || "{}"); } catch { return {}; } })();
    const resolved = new Map<string, IgdbGame | null>();
    let completed = 0;
    const queue = [...games];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const piko = queue.shift();
        if (!piko) return;
        const key = piko.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        try {
          if (Object.prototype.hasOwnProperty.call(cache, key)) resolved.set(piko.id, cache[key]);
          else {
            const candidates = await lookupIgdbGames(client, piko.name);
            resolved.set(piko.id, bestIgdbMatch(piko.name, candidates));
          }
        } catch (error) { console.warn(`IGDB lookup failed for ${piko.name}`, error); resolved.set(piko.id, null); }
        completed += 1;
        updateNotificationProgress(jobId, { value: completed, total: games.length }, `Looking up games: ${completed} of ${games.length}`);
      }
    });
    await Promise.all(workers);
    completed = 0;
    const artworkQueue = [...games];
    const artworkWorkers = Array.from({ length: Math.min(3, artworkQueue.length) }, async () => {
      while (artworkQueue.length) {
        const piko = artworkQueue.shift();
        if (!piko) return;
        const metadata = resolved.get(piko.id) ?? null;
        if (metadata) {
          const enriched = applyIgdbMetadata(piko, metadata);
          if (enriched.artworkUrl) await cacheIgdbArtwork(enriched);
          const key = piko.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
          cache[key] = metadata;
        }
        completed += 1;
        updateNotificationProgress(jobId, { value: completed, total: games.length }, `Saving cover images and game details: ${completed} of ${games.length}`);
      }
    });
    await Promise.all(artworkWorkers);
    window.localStorage.setItem(igdbCacheKey(userId), JSON.stringify(cache));
    setLibrary(current => current.map(piko => resolved.has(piko.id) ? applyIgdbMetadata(piko, resolved.get(piko.id) ?? null) : piko));
    const completedMessage = `IGDB update finished for ${games.length} games.`;
    setNotifications(current => current.map(item => item.id === jobId ? { ...item, message: completedMessage, progress: { value: games.length, total: games.length } } : item));
  };

  const addGameToLibrary = (name: string, executablePath: string, metadata: IgdbGame | null, category = platformCategory.trim() || "Custom") => {
    const piko: Piko = {
      id: `custom-${crypto.randomUUID()}`, name, executablePath, source: "custom", platformCategory: category,
      categories: [], description: "Custom game added to your local library.", accent: "#a99ad6", artwork: "linear-gradient(145deg, rgba(73,57,103,.35), rgba(20,16,29,.96))",
      tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" }],
    };
    const enriched = applyIgdbMetadata(piko, metadata);
    setLibrary((current) => [...current, enriched]);
    void cacheIgdbArtwork(enriched);
    setSelectedPikoId(piko.id);
    setSelectedTofuId("default");
    setPendingGame(null);
    setAddGameStep("form");
    setShowCustomGame(false);
    setShowAddPiko(false);
  };

  const addImportedGames = (games: ImportedGame[]) => {
    const now = Date.now();
    const freshGames = games.filter(imported => !library.some(piko => piko.name.trim().toLowerCase() === imported.name.trim().toLowerCase()));
    const created = freshGames.map(imported => ({
      id: `imported-${imported.source}-${imported.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${now}`,
      name: imported.name,
      description: `Imported from ${imported.source}. The original launcher remains responsible for the installation and runtime.`,
      accent: "#a99ad6",
      artwork: "linear-gradient(145deg, rgba(73,57,103,.35), rgba(20,16,29,.96))",
      artworkCacheKey: `${imported.source}-${imported.id}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
      executablePath: imported.launchTarget,
      source: "custom" as const,
      sourceId: imported.source,
      platformCategory: imported.source === "steam" ? "Steam" : imported.source === "heroic" ? "Heroic" : imported.source === "lutris" ? "Lutris" : imported.source === "bottles" ? "Bottles" : imported.source === "itch" ? "itch.io" : "Flatpak",
      categories: [],
      tofus: [{ id: "default", name: "Default", version: "Imported", runtime: imported.source, mods: 0, status: "Ready" as const }],
    } satisfies Piko));
    setLibrary(current => [...current, ...created.filter(piko => !current.some(item => item.id === piko.id))]);
    if (created.length && credentialStatus.igdb) void enrichImportedGames(created);
    if (games[0]) {
      const first = games[0];
      const id = `imported-${first.source}-${first.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${now}`;
      setSelectedPikoId(id);
      setSelectedTofuId("default");
    }
    setShowAddPiko(false);
    setShowImportPicker(false);
  };

  const addCustomGame = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const executablePath = normalizeLaunchTarget(launchTarget, launchType);
    if (!name || !executablePath) return;

    const hasIgdb = Boolean(supabase && user && credentialStatus.igdb);
    if (!hasIgdb) {
      addGameToLibrary(name, executablePath, null);
      return;
    }

    setIgdbBusy(true);
    try {
      const candidates = await lookupIgdbGames(supabase!, name);
      setPendingGame({ name, executablePath, platformCategory: String(form.get("platformCategory") || "Custom").trim() || "Custom", candidates });
      setAddGameStep("igdb");
    } catch (error) {
      console.warn("IGDB lookup failed", error);
      setPendingGame({ name, executablePath, platformCategory: String(form.get("platformCategory") || "Custom").trim() || "Custom", candidates: [] });
      setAddGameStep("igdb");
    } finally {
      setIgdbBusy(false);
    }
  };

  const hasIgdb = Boolean(igdbClientId.trim() && igdbClientSecret.trim());

  const approveIgdbGame = (metadata: IgdbGame | null) => {
    if (!pendingGame) return;
    addGameToLibrary(pendingGame.name, pendingGame.executablePath, metadata, pendingGame.platformCategory);
  };

  const refreshAllIgdbData = async () => {
    if (!supabase || !user || !credentialStatus.igdb || igdbRefreshBusy) return;
    setIgdbRefreshBusy(true);
    try {
      window.localStorage.removeItem(igdbCacheKey(user.id));
      await invoke("clear_game_artwork_cache");
      setLibrary(current => current.map(piko => ({
        ...piko,
        igdbId: undefined,
        artworkUrl: undefined,
        artworkCacheKey: undefined,
        screenshots: undefined,
        trailerId: undefined,
        firstReleaseDate: undefined,
        categories: piko.sourceId ? [] : piko.categories,
        description: piko.sourceId ? `Imported from ${piko.platformCategory || piko.sourceId}. The original launcher remains responsible for the installation and runtime.` : piko.description,
        artwork: piko.sourceId ? "linear-gradient(145deg, rgba(73,57,103,.35), rgba(20,16,29,.96))" : piko.artwork,
      })));
      const candidates = library.filter(piko => Boolean(piko.sourceId || piko.platformCategory));
      pushNotification("IGDB refresh started", `Refreshing metadata for ${candidates.length} library games.`);
      await enrichImportedGames(candidates);
      pushNotification("IGDB refresh finished", `Updated metadata for ${candidates.length} library games.`);
    } catch (error) {
      pushNotification("IGDB refresh failed", error instanceof Error ? error.message : "Could not refresh game metadata.");
    } finally {
      setIgdbRefreshBusy(false);
    }
  };

  useEffect(() => {
    if (!supabase || !user) {
      setCredentialStatus({ igdb: false, nexus: false });
      return;
    }
    void Promise.all([
      getProviderCredentialStatus(supabase, "igdb"),
      getProviderCredentialStatus(supabase, "nexus"),
    ]).then(([igdb, nexus]) => { setCredentialStatus({ igdb, nexus }); setCredentialStatusLoaded(true); }).catch((error) => {
      console.warn("Mochi provider credential status unavailable", error);
    });
  }, [user]);

  const saveCredential = async (provider: "igdb" | "nexus") => {
    if (!supabase || !user) {
      setAuthNotice("Sign in to save provider credentials securely.");
      setShowAuth(true);
      return;
    }
    const secret = provider === "igdb"
      ? JSON.stringify({ clientId: igdbClientId.trim(), clientSecret: igdbClientSecret.trim() })
      : nexusApiKey.trim();
    if (provider === "igdb" && (!igdbClientId.trim() || !igdbClientSecret.trim())) {
      setIgdbMessage("Enter your IGDB Client ID and Client Secret first.");
      return;
    }
    if (provider === "nexus") {
      const validationError = validateNexusApiKey(secret);
      if (validationError) { setIgdbMessage(validationError); return; }
    }
    if (!secret || secret.length < 8) return;
    setCredentialBusy(provider);
    try {
      await saveProviderCredential(supabase, provider, secret);
      setCredentialStatus((current) => ({ ...current, [provider]: true }));
      if (provider === "nexus") setNexusApiKey("");
      setIgdbMessage(provider === "igdb" ? "IGDB credentials saved securely to Mochi Vault." : "Nexus Mods key saved securely to Mochi Vault.");
    } catch (error) {
      setIgdbMessage(error instanceof Error ? error.message : "Unable to save provider credentials.");
    } finally {
      setCredentialBusy(null);
    }
  };

  const lookupArtwork = async () => {
    setIgdbMessage("");
    setIgdbBusy(true);
    try {
      const result = await lookupIgdbGame(supabase!, selectedPiko.name);
      if (!result) { setIgdbMessage("Configure IGDB credentials in the API settings first."); return; }
      const artworkUrl = resolveIgdbImage(result.cover?.url, "t_1080p") || resolveIgdbImage(result.artworks?.[0]?.url, "t_1080p");
      setLibrary((current) => current.map((piko) => piko.id === selectedPiko.id ? {
        ...piko, description: result.summary || piko.description, artworkUrl,
        artwork: artworkUrl ? `linear-gradient(145deg, rgba(10,15,20,.2), rgba(11,15,20,.94)), url('${artworkUrl}')` : piko.artwork,
      } : piko));
      setIgdbMessage(artworkUrl ? "Artwork and metadata updated locally." : "Game found, but no artwork was provided.");
    } catch (error) {
      setIgdbMessage(error instanceof Error ? error.message : "IGDB metadata is unavailable right now.");
    } finally { setIgdbBusy(false); }
  };

  const startMfaChallenge = async () => {
    if (!supabase) return;
    try {
      const factor = await getVerifiedTotpFactor(supabase);
      if (!factor) return;
      setMfaFactorId(factor.id);
      setMfaRequired(true);
      setMfaMessage("Enter the 6-digit code from your authenticator app.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to start MFA.");
    }
  };

  const completeMfa = async () => {
    if (!supabase || !mfaFactorId || !mfaCode) return;
    setAuthBusy(true);
    try {
      await verifyMfaCode(supabase, mfaFactorId, mfaCode);
      setMfaRequired(false);
      setMfaCode("");
      setMfaMessage("");
      setShowAuth(false);
    } catch (error) {
      setMfaMessage(error instanceof Error ? error.message : "Invalid authentication code.");
    } finally {
      setAuthBusy(false);
    }
  };

  const loadSecurity = async () => {
    if (!supabase || !user) return;
    const [mfaResult, passkeyResult] = await Promise.all([supabase.auth.mfa.listFactors(), listPasskeys(supabase)]);
    if (!mfaResult.error) setSecurityFactors(mfaResult.data.totp ?? []);
    if (!passkeyResult.error) setPasskeys(passkeyResult.data ?? []);
  };

  const addAuthenticator = async () => {
    if (!supabase || !user) return;
    setSecurityBusy(true);
    try {
      const { data, error } = await enrollTotp(supabase, "Mochi authenticator");
      if (error) throw error;
      if (data?.totp?.qr_code) {
        setMfaSetup({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret || "" });
        setMfaCode("");
        setAuthNotice("Scan the QR code with your authenticator app, then verify the six-digit code.");
      }
      await loadSecurity();
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Unable to enroll an authenticator.");
    } finally { setSecurityBusy(false); }
  };

  const verifyAuthenticatorSetup = async () => {
    if (!supabase || !mfaSetup || !mfaCode) return;
    setSecurityBusy(true);
    try {
      const result = await verifyMfaCode(supabase, mfaSetup.id, mfaCode);
      if (result.error) throw result.error;
      setMfaSetup(null);
      setMfaCode("");
      setAuthNotice("Authenticator enabled successfully.");
      await loadSecurity();
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "The authenticator code could not be verified.");
    } finally { setSecurityBusy(false); }
  };

  const removeAuthenticator = async (factorId: string) => {
    if (!supabase) return;
    setSecurityBusy(true);
    try {
      const { error } = await removeTotp(supabase, factorId);
      if (error) throw error;
      setAuthNotice("Authenticator removed.");
      await loadSecurity();
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Unable to remove the authenticator.");
    } finally { setSecurityBusy(false); }
  };

  const addPasskey = async () => {
    if (!supabase) return;
    setSecurityBusy(true);
    try {
      const { error } = await registerPasskey(supabase);
      if (error) throw error;
      setAuthNotice("Passkey registered successfully.");
      await loadSecurity();
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Unable to register a passkey.");
    } finally { setSecurityBusy(false); }
  };

  const unlinkAuthIdentity = async (provider: "google" | "github") => {
    if (!supabase || !user) return;
    const identity = (user.identities ?? []).find((item) => item.provider === provider);
    if (!identity) return;
    if ((user.identities ?? []).length < 2) {
      setAuthNotice("Add another sign-in method before unlinking this account.");
      return;
    }
    const providerName = provider === "google" ? "Google" : "GitHub";
    if (!window.confirm("Unlink " + providerName + " from your Mochi account? You will no longer be able to sign in with " + providerName + " until you connect it again.")) return;
    setSecurityBusy(true);
    setAuthNotice("");
    try {
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) throw error;
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (userData.user) setUser(userData.user);
      setAuthNotice(providerName + " was unlinked from your Mochi account.");
      await loadSecurity();
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Unable to unlink " + providerName + ".");
    } finally {
      setSecurityBusy(false);
    }
  };

  const removePasskey = async (passkeyId: string) => {
    if (!supabase) return;
    setSecurityBusy(true);
    try {
      const { error } = await deletePasskey(supabase, passkeyId);
      if (error) throw error;
      setAuthNotice("Passkey removed.");
      await loadSecurity();
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Unable to remove the passkey.");
    } finally { setSecurityBusy(false); }
  };

  useEffect(() => {
    if (user) void loadSecurity();
    else { setSecurityFactors([]); setPasskeys([]); }
  }, [user?.id]);

  const resetLocalData = async () => {
    if (!window.confirm("Clear all Mochi app data and return to the welcome screen? Your Mochi account will not be deleted.")) return;
    window.localStorage.clear();
    if (supabase) await supabase.auth.signOut({ scope: "local" });
    try { await invoke("clear_mochi_app_data"); } catch { /* browser/development mode */ }
    window.location.reload();
  };

  const clearCloudData = async () => {
    if (!supabase || !user || !cloudDataAccessAllowed || cloudDataBusy) return;
    if (!window.confirm("Delete all Mochi Cloud Pikos and Tofus for this account? Your local library, account, and saved provider credentials will not be changed.")) return;
    setCloudDataBusy(true);
    setCloudDataMessage("");
    try {
      const deleted = await clearAccountCloudData(supabase);
      syncInitialized.current = cloudSyncEnabled;
      setSyncState(cloudSyncEnabled ? "synced" : "offline");
      setCloudDataMessage(`Cloud library cleared. Removed ${deleted.deleted_pikos} Pikos and ${deleted.deleted_tofus} Tofus. Your local library and saved provider credentials were not changed.`);
    } catch (error) {
      setCloudDataMessage(error instanceof Error ? error.message : "Unable to clear cloud library data.");
    } finally {
      setCloudDataBusy(false);
    }
  };

  const requestEmailCode = async () => {
    if (!supabase) return;
    const emailInput = document.querySelector<HTMLInputElement>('input[name="email"]');
    const email = emailInput?.value.trim().toLowerCase() ?? "";
    if (!email) {
      emailInput?.reportValidity();
      setAuthError("Enter your email address first.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await sendEmailCode(supabase, email);
      if (error) throw error;
      setEmailCodeEmail(email);
      setEmailCode("");
      setEmailCodeStep(true);
      setAuthNotice("Verification code sent. Check your email.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to send the verification code.");
    } finally {
      setAuthBusy(false);
    }
  };

  const submitEmailCode = async () => {
    if (!supabase || !emailCodeEmail) return;
    const token = emailCode.replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) {
      setAuthError("Enter the 6-digit verification code from your email.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await verifyEmailCode(supabase, emailCodeEmail, token);
      if (error) throw error;
      setAuthNotice("Signed in successfully.");
      setEmailCodeStep(false);
      setShowAuth(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "The verification code could not be verified.");
    } finally {
      setAuthBusy(false);
    }
  };

  const openWebsiteSignIn = () => {
    void invoke("open_external_url", { url: "https://t1nkieplayz.github.io/Mochi-Website/#/signin?app=mochi" })
      .catch((error) => setAuthError(error instanceof Error ? error.message : "Unable to open the Mochi website."));
  };

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      const result =
        authMode === "sign-in"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: "mochi://auth/verify" } });
      if (result.error) {
        setAuthError(result.error.message);
      } else if (authMode === "sign-up") {
        setAuthNotice("Account created. Check your email if confirmation is enabled.");
        setShowAuth(false);
      } else {
        const factor = await getVerifiedTotpFactor(supabase);
        if (factor) {
          setMfaFactorId(factor.id);
          setMfaRequired(true);
          setMfaMessage("MFA is enabled on this account. Enter your authenticator code.");
        } else {
          setShowAuth(false);
        }
      }
    } catch (error) {
      // A network failure must not leave the form stuck on "Connecting...".
      setAuthError(error instanceof Error ? error.message : "Unable to reach Mochi. Check your connection and try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    const currentId = user?.id;
    if (!supabase) return;
    if (currentId) {
      setSavedAccounts((current) => {
        const next = current.filter((item) => item.id !== currentId);
        window.localStorage.setItem("mochi:accounts", JSON.stringify(next));
        return next;
      });
    }
    await supabase.auth.signOut({ scope: "local" });
    setShowAccountMenu(false);
  };

  const authModal = <div className="modal-backdrop" onClick={() => setShowAuth(false)}><form className="modal auth-modal" onSubmit={authenticate} onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><div className="auth-brand"><img src="/mochi.png" alt="Mochi" /><div><p className="eyebrow">Mochi Cloud</p><h2>{emailCodeStep ? "Check your email." : authMode === "sign-in" ? "Welcome back." : "Create your account."}</h2></div></div><button className="icon-button" type="button" onClick={() => setShowAuth(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div>
    {emailCodeStep ? <>
      <p className="modal-description">We sent a six-digit verification code to <strong>{emailCodeEmail}</strong>. Enter it below to finish signing in.</p>
      <div className="form-fields"><label>Verification code<input className="mfa-input" inputMode="numeric" autoComplete="one-time-code" value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" maxLength={6} /></label></div>
      {authError && <p className="auth-error">{authError}</p>}
      {authNotice && <p className="auth-notice">{authNotice}</p>}
      <button className="play-button form-submit" type="button" disabled={authBusy || emailCode.length !== 6} onClick={submitEmailCode}>{authBusy ? "Verifying..." : "Verify and sign in"}</button>
      <button type="button" className="switch-auth" onClick={() => { setEmailCodeStep(false); setAuthError(""); setAuthNotice(""); }}>Use a different sign-in method</button>
    </> : <>
      <p className="modal-description">{authMode === "sign-in" ? "Sign in to access your securely stored API credentials and, if you enable it, keep Mochi metadata available across devices." : "Your games stay local. Your Mochi metadata can follow you."}</p>
      <div className="form-fields"><label>Email<input name="email" type="email" placeholder="you@example.com" required /></label><label>Password<input name="password" type="password" minLength={6} placeholder="At least 6 characters" required /></label></div>
      {authError && <p className="auth-error">{authError}</p>}{authNotice && <p className="auth-notice">{authNotice}</p>}
      {mfaRequired ? <div className="mfa-challenge"><div className="mfa-shield"><MochiIcon name="security" fallback={ShieldCheck} size={25}/></div><p className="mfa-title">Two-factor authentication</p><p className="mfa-description">{mfaMessage}</p><label className="mfa-code-label">Authentication code<input className="mfa-input" inputMode="numeric" autoComplete="one-time-code" aria-label="Six digit authentication code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6} autoFocus /></label><button className="play-button form-submit" type="button" disabled={authBusy || mfaCode.length !== 6} onClick={completeMfa}>{authBusy ? "Verifying..." : "Verify and continue"}</button><button className="switch-auth" type="button" onClick={() => { setMfaRequired(false); setMfaCode(""); setMfaMessage(""); }}>Use another sign-in method</button></div> : <><button className="play-button form-submit" disabled={authBusy} type="submit">{authBusy ? "Connecting..." : authMode === "sign-in" ? "Sign in" : "Create account"}</button>
      <div className="auth-provider-row auth-provider-row-three"><button type="button" className="secondary-button" onClick={requestEmailCode}>{authBusy ? "Sending..." : "Sign in with code"}</button><button type="button" className="secondary-button" onClick={() => { setAuthError(""); void signInWithProvider(supabase!, "github").then(({ error }) => { if (error) setAuthError(error.message); }); }}><MochiIcon name="github" fallback={Github} size={15}/> GitHub</button><button type="button" className="secondary-button" onClick={() => { setAuthError(""); void signInWithProvider(supabase!, "google").then(({ error }) => { if (error) setAuthError(error.message); }); }}><GoogleIcon /> Google</button></div>
      <div className="auth-website-row"><button type="button" className="secondary-button" onClick={openWebsiteSignIn}>Use website</button></div>
      <button className="switch-auth" type="button" onClick={() => { setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in"); setAuthError(""); setAuthNotice(""); }}>{authMode === "sign-in" ? "New to Mochi? Create an account" : "Already have an account? Sign in"}</button></>}
    </>}
  </form></div>;

  if (showFirstLaunchSetup) {
    return <>
      <FirstLaunchSetup
        igdbClientId={igdbClientId}
        setIgdbClientId={setIgdbClientId}
        igdbClientSecret={igdbClientSecret}
        setIgdbClientSecret={setIgdbClientSecret}
        onSignIn={() => { setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); }}
        signedIn={Boolean(user)}
        credentialStatus={credentialStatus}
        credentialStatusLoaded={credentialStatusLoaded}
        themes={themes}
        theme={theme}
        setTheme={setTheme}
        nexusApiKey={nexusApiKey}
        setNexusApiKey={setNexusApiKey}
        saveCredential={saveCredential}
        credentialBusy={credentialBusy}
        onFinish={finishFirstLaunchSetup}
      />
      {showAuth ? authModal : null}
    </>;
  }

  if (!selectedPiko || !selectedTofu) return null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img src="/mochi.png" alt="Mochi" /></div><div><strong>Mochi</strong><span>Your games, your way.</span></div></div>
        <div className="sidebar-account-wrap">
          <button className="sidebar-account" aria-expanded={showAccountMenu} onClick={() => setShowAccountMenu((open) => !open)}><AccountAvatar user={user} size={34} /><span><strong>{currentUsername}</strong><small>{user ? "Mochi account" : "Sign in to Mochi"}</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={14} /></button>
          {showAccountMenu && <div className="account-menu">{multipleAccountsEnabled && savedAccounts.map((account) => <button type="button" key={account.id} className={account.id === user?.id ? "selected" : ""} onClick={() => void switchAccount(account)}><span className="account-menu-avatar">{account.avatarUrl ? <img className="account-menu-avatar-image" src={account.avatarUrl} alt="" referrerPolicy="no-referrer" /> : account.username.slice(0, 1).toUpperCase()}</span><span><strong>{account.username}</strong><small>Mochi account</small></span></button>)}{!user && <button type="button" className="account-menu-add" onClick={addAccount}><Plus size={14} /><span><strong>Sign in</strong><small>Add a Mochi account</small></span></button>}{user && multipleAccountsEnabled && savedAccounts.length < 5 && <button type="button" className="account-menu-add" onClick={addAccount}><Plus size={14} /><span><strong>Add User</strong><small>Sign in to another Mochi account</small></span></button>}{user && <button type="button" className="account-menu-add" onClick={signOut}><span className="account-menu-avatar">↪</span><span><strong>Sign out</strong><small>Keep local Mochi data</small></span></button>}</div>}
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.filter(({ label }) => label !== "Installed" || behavior.experimentalFeatures).map(({ label, icon: Icon }) => (
            <button
              className={`nav-item ${activeNav === label ? "active" : ""}`}
              key={label}
              onClick={() => setActiveNav(label)}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>

            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className={`nav-item ${activeNav === "Settings" ? "active" : ""}`} onClick={() => setActiveNav("Settings")}>
            <MochiIcon name="settings" fallback={Settings} size={17} strokeWidth={1.8} />
            <span>Settings</span>
          </button>

        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open menu"><MochiIcon name="menu" fallback={Menu} size={18} /></button>
          <div className="breadcrumb"><span>Mochi</span><span className="breadcrumb-slash">/</span><strong>{activeNav === "Library" ? selectedPiko.name : activeNav}</strong></div>
          <div className="topbar-actions">
            <label className="search-box">
              <MochiIcon name="search" fallback={Search} size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" />
              {search && <button className="clear-search" onClick={() => setSearch("")}><MochiIcon name="close" fallback={X} size={13} /></button>}
              {!search && <kbd>⌘ K</kbd>}
            </label>
            {behavior.notificationsEnabled && behavior.inAppNotifications && (
              <div className="notification-wrap">
                <button className="icon-button" aria-label="Notifications" aria-expanded={showNotifications} onClick={() => setShowNotifications((open) => !open)}>
                  <MochiIcon name="notifications" fallback={Bell} size={17} />{notifications.length > 0 && <span className="notification-dot" />}
                </button>
                {showNotifications && <div className="notification-popover">
                  <div className="notification-heading"><strong>Notifications</strong>{notifications.length > 0 && <button type="button" onClick={() => setNotifications([])}>Clear</button>}</div>
                  {notifications.length ? notifications.map((item) => <div className="notification-item" key={item.id}><strong>{item.title}</strong><span>{item.message}</span>{item.progress && <progress max={item.progress.total} value={item.progress.value} />}</div>) : <div className="notification-empty">You’re all caught up.</div>}
                </div>}
              </div>
            )}
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div><p className="eyebrow">Your collection</p><h1>{activeNav === "Library" ? `${greeting}${user ? ", " + currentUsername : ""}.` : activeNav}</h1></div>
            {activeNav === "Library" && <button className="secondary-button" onClick={() => setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> Add Piko</button>}
          </section>

          {activeNav === "Library" && gameDetailsId && library.some(piko => piko.id === gameDetailsId) ? (
            <GameDetails game={library.find(piko => piko.id === gameDetailsId)!} synced={syncState === "synced"} onBack={() => setGameDetailsId("")} onPlay={() => { const game = library.find(piko => piko.id === gameDetailsId); if (game) { selectPiko(game); void launchGame(game); } }} />
          ) : activeNav === "Library" && library.length === 0 ? (
            <div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>Your Mochi library is empty.</h2><p>Mochi starts clean. Add a game when you are ready.</p><button className="secondary-button" onClick={() => setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> Add Piko</button></div>
          ) : activeNav === "Library" ? (
            <>
              <section className="library-grid-view">
                {groupedPikos.map(([category, games]) => <div className="library-category" key={category}><div className="section-heading"><div><p className="eyebrow">Category</p><h3>{category}</h3></div><span className="category-count">{games.length} game{games.length === 1 ? "" : "s"}</span></div><div className="game-card-grid">{games.map((piko) => <button className={`game-card ${selectedPiko.id === piko.id ? "selected" : ""}`} key={piko.id} onClick={() => { selectPiko(piko); setGameDetailsId(piko.id); }}><GameArtwork className="game-card-art" cacheKey={piko.artworkCacheKey} fallback={piko.artwork} /><div className="game-card-copy"><strong>{piko.name}<span className={`game-cloud-status ${syncState === "synced" ? "is-synced" : "not-synced"}`} title={syncState === "synced" ? "Synced to Mochi Cloud" : "Not synced to Mochi Cloud"}>{syncState === "synced" ? "✓" : "!"}</span></strong><small>{piko.categories?.join(" · ") || piko.platformCategory || "Other"}</small></div><span className="game-card-play"><MochiIcon name="play" fallback={Play} size={15} fill="currentColor"/></span></button>)}</div></div>)}
              </section>
              <LibraryModSearch query={search} nexusEnabled={behavior.experimentalFeatures && credentialStatus.nexus} supabase={supabase} />
              <section className="hero-card" style={{ backgroundImage: selectedPiko.artwork }}>
                <div className="hero-copy">
                  <span className="hero-kicker"><span className="live-dot" /> Last played recently</span>
                  <h2>{selectedPiko.name}</h2>
                  <p>{selectedPiko.description}</p>
                  <div className="hero-actions">
                    <button className="play-button" onClick={() => void launchGame()}><MochiIcon name="play" fallback={Play} size={16} fill="currentColor" /> {isLaunching ? "Launching..." : "Play"}</button>
                    {selectedPiko.source === "custom" && <span className="metadata-note">{selectedPiko.executablePath}</span>}
                    <button className="icon-button dark-button" aria-label="More options"><MochiIcon name="more" fallback={MoreHorizontal} size={19} /></button>{launchError && <span className="metadata-note">{launchError}</span>}
                  </div>
                </div>
                <div className="hero-meta"><span>Playtime</span><strong>{selectedPlaytime ? formatPlaytime(selectedPlaytime.seconds) : "Not played yet"}</strong></div>
              </section>

              <section className="tofu-section">
                <div className="section-heading"><div><p className="eyebrow">Environments</p><h3>Your Tofus</h3></div><button className="text-button"><MochiIcon name="manage" fallback={SlidersHorizontal} size={15} /> Manage</button></div>
                <div className="tofu-grid">
                  {selectedPiko.tofus.map((tofu) => (
                    <button className={`tofu-card ${selectedTofu.id === tofu.id ? "active" : ""}`} key={tofu.id} onClick={() => setSelectedTofuId(tofu.id)}>
                      <div className="tofu-card-top"><span className="tofu-symbol">🧊</span><span className={`ready-status ${tofu.status === "Ready" ? "" : "attention"}`}><span />{tofu.status}</span></div>
                      <strong>{tofu.name}</strong>
                      <span className="tofu-details">{tofu.version} <i /> {tofu.runtime}</span>
                      <span className="tofu-mods">{tofu.mods ? `${tofu.mods} mods installed` : "No mods installed"}</span>
                    </button>
                  ))}
                  <button className="new-tofu-card" onClick={() => setShowNewTofu(true)}><MochiIcon name="plus" fallback={Plus} size={17} /><span>New Tofu</span><small>Set up another environment</small></button>
                </div>
              </section>

              <section className="details-strip">
                <div><span className="detail-label">Selected Tofu</span><strong>🧊 {selectedTofu.name}</strong></div>
                <div><span className="detail-label">Runtime</span><strong>{selectedTofu.runtime} <span className="muted">· {selectedTofu.version}</span></strong></div>
                <div><span className="detail-label">Install location</span><strong className="path-text">{selectedTofu.path || "~/Games/" + selectedPiko.name.replace(/\s+/g, "")}</strong></div>
                <button className="icon-button"><MochiIcon name="settings" fallback={Settings} size={16} /></button>
              </section>

              <ModrinthManager key={selectedTofu.id} tofu={selectedTofu} onPathChange={(path) => updateSelectedTofu({ path })} />
            </>
          ) : activeNav === "Settings" ? (
            <section className="settings-page">
              <div className="settings-intro"><p className="eyebrow">Preferences</p><h2>Make Mochi yours.</h2><p>These settings are stored locally on this device. Cloud sync can be enabled later without changing your library.</p></div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>Appearance</strong><span>Personalize the launcher</span></div>
                <div className="theme-grid">
                  {themes.map((option) => (
                    <button key={option.id} className={"theme-card " + (theme === option.id ? "selected" : "")} onClick={() => void setTheme(option.id)}>
                      <MochiIcon name="palette" fallback={Palette} size={16} />
                      <strong>{option.name}</strong>
                      <small>{option.description || "Mochi theme"}</small>
                      <small className="theme-card-meta">{option.source === "builtin" ? "Built-in" : "v" + option.version + " · " + (option.author || "User theme")}</small>
                    </button>
                  ))}
                </div>
                <div className="theme-actions">
                  <button className="secondary-button" onClick={() => void importThemeFile().then((result) => { if (result) void reloadThemes(); }).catch((error) => setLaunchError(error instanceof Error ? error.message : String(error)))}><MochiIcon name="theme-file" fallback={FileJson} size={14} /> Import theme file</button>
                  <button className="secondary-button" onClick={() => void importThemeFolder().then((result) => { if (result) void reloadThemes(); }).catch((error) => setLaunchError(error instanceof Error ? error.message : String(error)))}><MochiIcon name="folder" fallback={FolderOpen} size={14} /> Import theme folder</button>
                </div>
                {configInfo && <div className="theme-config-path"><span>Theme directory</span><code>{configInfo.themesPath}</code></div>}
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>Mod & metadata providers</strong><span>Credentials are encrypted with Supabase Vault</span></div>
                <div className="provider-grid">
                  <div className="provider-credential-card">
                    <div className="provider-credential-heading"><div><strong>IGDB</strong><small>Store your Twitch Client ID and Client Secret securely with your Mochi account.</small></div><span className={credentialStatus.igdb ? "credential-status saved" : "credential-status"}>{user && credentialStatus.igdb ? "Saved" : user ? "Not saved" : "Sign in required"}</span></div>
                    {user ? (
                      <>
                        <div className="provider-fields"><input value={igdbClientId} onChange={(event) => setIgdbClientId(event.target.value)} placeholder="Twitch Client ID" /><input type="password" value={igdbClientSecret} onChange={(event) => setIgdbClientSecret(event.target.value)} placeholder="Twitch Client Secret" /></div>
                        <button className="secondary-button" onClick={() => void saveCredential("igdb")} disabled={credentialBusy !== null}>{credentialBusy === "igdb" ? "Saving..." : "Save IGDB securely"}</button>
                        {igdbMessage && <small className="metadata-note">{igdbMessage}</small>}
                      </>
                    ) : (
                      <button className="secondary-button" onClick={() => { setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); }}>
                        <MochiIcon name="account" fallback={UserRound} size={14} /> Sign in to save
                      </button>
                    )}
                  </div>
                  <div className="provider-credential-card">
                    <div className="provider-credential-heading"><div><strong>Nexus Mods</strong><small>Your Nexus API key is stored server-side and is never returned to the launcher.</small></div><span className={credentialStatus.nexus ? "credential-status saved" : "credential-status"}>{credentialStatus.nexus ? "Saved" : "Not saved"}</span></div>
                    {user ? <><input type="password" value={nexusApiKey} maxLength={4096} onChange={(event) => setNexusApiKey(event.target.value)} placeholder={credentialStatus.nexus ? "Enter a new key to replace the saved key" : "Paste your Nexus Mods Personal API Key"} autoComplete="off" spellCheck={false} /><small className="metadata-note">Use the full Personal API Key (at least 32 characters). Mochi verifies it with Nexus Mods before saving.</small><button className="secondary-button" onClick={() => void saveCredential("nexus")} disabled={credentialBusy !== null || Boolean(validateNexusApiKey(nexusApiKey))}>{credentialBusy === "nexus" ? "Validating..." : "Save Nexus securely"}</button></> : <button className="secondary-button" onClick={() => { setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); }}><MochiIcon name="account" fallback={UserRound} size={14} /> Sign in to save</button>}
                  </div>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>General</strong><span>Launcher behavior</span></div>
                <label className="setting-row"><span><strong>Launch Mochi on startup</strong><small>Open the launcher when you sign in to your computer.</small></span><input className="toggle" checked={behavior.launchOnStartup} onChange={(event) => setBehavior({ ...behavior, launchOnStartup: event.target.checked })} type="checkbox" /></label>
                <label className="setting-row"><span><strong>Notifications</strong><small>Enable or disable all Mochi notifications.</small></span><input className="toggle" checked={behavior.notificationsEnabled} onChange={(event) => { const enabled = event.target.checked; setBehavior({ ...behavior, notificationsEnabled: enabled }); if (!enabled) setShowNotifications(false); }} type="checkbox" /></label>
                <label className="setting-row"><span><strong>In-app notifications</strong><small>Show the notification button and updates inside Mochi.</small></span><input className="toggle" checked={behavior.inAppNotifications} disabled={!behavior.notificationsEnabled} onChange={(event) => { setBehavior({ ...behavior, inAppNotifications: event.target.checked }); if (!event.target.checked) setShowNotifications(false); }} type="checkbox" /></label>
                <label className="setting-row"><span><strong>System notifications</strong><small>Allow Mochi to send desktop notifications.</small></span><input className="toggle" checked={behavior.systemNotifications} disabled={!behavior.notificationsEnabled} onChange={(event) => setBehavior({ ...behavior, systemNotifications: event.target.checked })} type="checkbox" /></label>
                <label className="setting-row"><span><strong>Separate account profiles</strong><small>{user ? "Keep libraries, preferences, and notifications separate for each signed-in account." : "Sign in before enabling separate profiles for multiple accounts."}</small></span><input className="toggle" checked={multipleAccountsEnabled} disabled={!user} onChange={(event) => setMultipleAccountProfiles(event.target.checked)} type="checkbox" /></label>
                <div className="setting-row"><span><strong>System tray service</strong><small>Closing the Mochi window keeps the launcher running in the tray. Use Quit Mochi from the tray menu to fully exit.</small></span><span className="metadata-note">Always active</span></div>
              </div>
              <div className="settings-group security-settings-group">
                <div className="settings-group-heading"><strong>Security</strong><span>Account protection and sign-in methods</span></div>
                {user ? <div className="security-settings">
                  <div className="security-card"><div className="security-card-icon"><MochiIcon name="security" fallback={ShieldCheck} size={18}/></div><div className="security-card-copy"><strong>Authenticator app</strong><small>{securityFactors.some((factor) => factor.status === "verified") ? "Two-factor authentication is enabled." : "Use a time-based one-time password for an extra layer of protection."}</small></div><span className={securityFactors.some((factor) => factor.status === "verified") ? "credential-status saved" : "credential-status"}>{securityFactors.some((factor) => factor.status === "verified") ? "Enabled" : "Not configured"}</span></div>
                  {mfaSetup ? <div className="mfa-setup-card"><div><strong>Set up your authenticator</strong><small>Scan this QR code in your authenticator app.</small></div><img src={mfaSetup.qr} alt="Authenticator setup QR code" /><code>{mfaSetup.secret}</code><div className="mfa-setup-actions"><input className="mfa-input" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6}/><button className="secondary-button" disabled={securityBusy || mfaCode.length !== 6} onClick={() => void verifyAuthenticatorSetup()}>Verify</button><button className="secondary-button" disabled={securityBusy} onClick={() => { setMfaSetup(null); setMfaCode(""); }}>Cancel</button></div></div> : <div className="security-actions"><button className="secondary-button" onClick={() => void addAuthenticator()} disabled={securityBusy}>{securityFactors.some((factor) => factor.status === "verified") ? "Add another authenticator" : "Set up authenticator"}</button>{securityFactors.filter((factor) => factor.status === "verified").map((factor) => <button key={factor.id} className="secondary-button danger-outline" disabled={securityBusy} onClick={() => void removeAuthenticator(factor.id)}>Remove authenticator</button>)}</div>}
                  <div className="security-card"><div className="security-card-icon"><Github size={18}/></div><div className="security-card-copy"><strong>Connected accounts</strong><small>Google and GitHub identities linked to this Mochi account.</small></div></div>
                  <div className="security-provider-grid">{(["google","github"] as const).map((provider) => {
                    const connected = (user.identities ?? []).find((identity) => identity.provider === provider);
                    const canUnlink = (user.identities ?? []).length > 1;
                    return <div className="security-provider" key={provider}>
                      <span className="security-provider-copy"><strong>{provider === "google" ? "Google" : "GitHub"}</strong><small>{connected ? "Connected" : "Not connected"}</small></span>
                      {connected ? (
                        <button type="button" className="secondary-button danger-outline security-provider-action" onClick={() => void unlinkAuthIdentity(provider)} disabled={securityBusy || !canUnlink} title={canUnlink ? "Unlink " + (provider === "google" ? "Google" : "GitHub") : "Add another sign-in method before unlinking this account."}>
                          <Unlink size={13} /> {canUnlink ? "Unlink" : "Required"}
                        </button>
                      ) : (
                        <button type="button" className="secondary-button security-provider-action" onClick={() => { if (supabase) void linkAuthIdentity(supabase, provider).then(({ error }) => { if (error) setAuthNotice(error.message); }).catch((error) => setAuthNotice(error instanceof Error ? error.message : "Unable to connect this account.")); }} disabled={securityBusy}>Connect</button>
                      )}
                    </div>;
                  })}</div>
                  <div className="security-card"><div className="security-card-icon"><KeyRound size={18}/></div><div className="security-card-copy"><strong>Passkeys</strong><small>Use a device, password manager, biometrics, or security key instead of a password.</small></div></div>
                  <div className="passkey-list">{passkeys.length ? passkeys.map((passkey) => <div className="passkey-row" key={passkey.id}><span><strong>{passkey.friendly_name || "Mochi passkey"}</strong><small>Added {passkey.created_at ? new Date(passkey.created_at).toLocaleDateString() : "recently"}</small></span><button className="secondary-button danger-outline" disabled={securityBusy} onClick={() => void removePasskey(passkey.id)}>Remove</button></div>) : <small className="metadata-note">No passkeys registered yet.</small>}<button className="secondary-button" disabled={securityBusy} onClick={() => void addPasskey()}>{securityBusy ? "Working..." : "Set up a passkey"}</button></div>
                  {authNotice && <small className="metadata-note security-notice">{authNotice}</small>}
                </div> : <div className="security-signed-out"><ShieldCheck size={18}/><span>Sign in to manage authenticator, connected-account, and passkey settings.</span><button className="secondary-button" onClick={() => { setAuthMode("sign-in"); setShowAuth(true); }}>Sign in</button></div>}
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>Data & privacy</strong><span>Local-first storage</span></div>
                <div className="setting-row"><span><strong>Refresh IGDB game metadata</strong><small>Clear cached IGDB details and artwork, then fetch current information for your library.</small></span><button type="button" className="secondary-button" disabled={!credentialStatus.igdb || igdbRefreshBusy || !library.length} onClick={() => void refreshAllIgdbData()}>{igdbRefreshBusy ? "Refreshing…" : "Refresh all metadata"}</button></div>
                {!credentialStatus.igdb && <small className="metadata-note" style={{ padding: "0 17px 12px" }}>Sign in and save IGDB credentials to refresh game information.</small>}
                <div className="setting-row"><span><strong>Cloud data</strong><small>{cloudDataAccessAllowed ? "Delete your cloud Pikos and Tofus. Your local library, account, and saved provider credentials stay unchanged." : "Mochi Cloud data controls are not enabled for this account."}</small></span><button type="button" className="secondary-button danger-outline" disabled={!user || !cloudDataAccessAllowed || cloudDataBusy} onClick={() => void clearCloudData()}>{cloudDataBusy ? "Clearing…" : cloudDataAccessAllowed ? "Clear cloud data" : "Unavailable"}</button></div>
                {cloudDataMessage && <p className="metadata-note" role="status" style={{ padding: "0 17px 14px" }}>{cloudDataMessage}</p>}
                <div className="setting-row setting-location-row"><span><strong>Library location</strong><small>Your Mochi configuration, themes and launcher data are stored here.</small></span><span className="setting-location-value"><code>{configInfo?.configPath || "Default Mochi location"}</code><button type="button" className="secondary-button" onClick={() => void chooseMochiConfigLocation()}>Change</button></span></div>
                <button className="setting-row setting-button" onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}><span><strong>Advanced settings</strong><small>Diagnostics and experimental launcher controls.</small></span><MochiIcon name="chevron" fallback={ChevronDown} className={showAdvancedSettings ? "rotate" : ""} size={16} /></button>
                {showAdvancedSettings && <div className="advanced-settings">
                  <label className="setting-row"><span><strong>Confirm before launching</strong><small>Ask before starting a game.</small></span><input className="toggle" checked={behavior.confirmLaunch} onChange={(event) => setBehavior({ ...behavior, confirmLaunch: event.target.checked })} type="checkbox" /></label>
                  <label className="setting-row"><span><strong>Detailed launch errors</strong><small>Show extra information when a game fails to launch.</small></span><input className="toggle" checked={behavior.detailedErrors} onChange={(event) => setBehavior({ ...behavior, detailedErrors: event.target.checked })} type="checkbox" /></label>
                  <label className="setting-row"><span><strong>Experimental features</strong><small>Show unfinished launcher features as they become available.</small></span><input className="toggle" checked={behavior.experimentalFeatures} onChange={(event) => setBehavior({ ...behavior, experimentalFeatures: event.target.checked })} type="checkbox" /></label>
                </div>}
              </div>
              <div className="settings-group"><div className="settings-group-heading"><strong>Help & feedback</strong><span>Report a problem or request a feature</span></div><a className="setting-row help-link" href="https://github.com/T1nkiePlayz/Mochi/issues" target="_blank" rel="noreferrer"><span><strong>GitHub issues</strong><small>View known issues or report a new one.</small></span><Github size={16}/></a></div>
              <button className="reset-button" onClick={resetLocalData}>Clear all Mochi app data</button>
            </section>
          ) : activeNav === "Discover" ? (
            <ModrinthDiscover tofu={selectedTofu} pikos={library} playtime={playtime} experimentalFeatures={behavior.experimentalFeatures} nexusConfigured={credentialStatus.nexus} supabase={supabase} />
          ) : activeNav === "Downloads" ? (
            <section className="downloads-page">
              <div className="downloads-intro"><p className="eyebrow">Activity</p><h2>Downloads</h2><p>Concurrent Modrinth downloads continue while Mochi is hidden in the tray. Completed downloads stay here for 10 minutes.</p></div>
              {!downloads.length ? <div className="download-empty"><div className="empty-icon"><MochiIcon name="downloads" fallback={Download} size={22} /></div><h3>No active downloads</h3><p>Nothing is downloading right now.</p></div> : (
                <div className="download-groups">
                  {[...new Map(downloads.map(download => [download.tofuId, download.tofuName])).entries()].map(([tofuId, tofuName]) => {
                    const items = downloads.filter(download => download.tofuId === tofuId);
                    return <section className="download-group" key={tofuId}>
                      <div className="download-group-heading"><strong>{tofuName}</strong><span>{items.length} {items.length === 1 ? "download" : "downloads"}</span></div>
                      <div className="download-list">{items.map(download => {
                        const progress = download.total ? Math.min(100, (download.downloaded / download.total) * 100) : 0;
                        return <article className="download-row" key={download.id}>
                          <div className="download-row-copy"><strong>{download.itemName}</strong><small>{download.filename}</small></div>
                          <div className="download-progress-wrap">
                            <div className={download.status === "downloading" && !download.total ? "download-progress indeterminate" : "download-progress"}><span style={{ width: download.status === "downloading" && download.total ? progress + "%" : download.status === "completed" ? "100%" : undefined }} /></div>
                            <small>{download.status === "failed" ? download.error || "Failed" : download.total ? (download.status === "completed" ? "Completed · " : Math.round(progress) + "% · ") + formatBytes(download.total) + " total" + (download.status === "downloading" ? " · " + formatBytes(download.downloaded) + " downloaded" : "") : download.status === "completed" ? "Completed · size unavailable" : formatBytes(download.downloaded) + " downloaded · size unavailable"}</small>
                          </div>
                        </article>;
                      })}</div>
                    </section>;
                  })}
                </div>
              )}
            </section>
          ) : (
            <div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>{activeNav} is ready when you are.</h2><p>This part of Mochi is taking shape. Your local library remains available offline.</p><button className="secondary-button" onClick={() => setActiveNav("Library")}><MochiIcon name="library" fallback={Library} size={16} /> Back to library</button></div>
          )}
          <footer><span>Mochi v0.1.0 · Local-first by design</span><span><MochiIcon name="cloud" fallback={Cloud} size={13} /> {syncState === "syncing" ? "Cloud sync syncing…" : syncState === "synced" ? "Cloud sync active" : syncState === "error" ? "Cloud sync error" : user && !cloudSyncEnabled ? "Cloud sync disabled" : "Cloud sync unavailable"}</span></footer>
        </div>
      </main>

      {showAddPiko && <div className="modal-backdrop" onClick={() => setShowAddPiko(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Expand your library</p><h2>Add a Piko</h2></div><button className="icon-button" onClick={() => setShowAddPiko(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div><p className="modal-description">Connect an installed game or add a custom game to start managing its Tofus in Mochi.</p><div className="add-options"><button onClick={() => { setShowImportPicker(true); setShowAddPiko(false); }}><MochiIcon name="library" fallback={Library} size={18} /><span><strong>Import from another platform</strong><small>Bring games in from an installed launcher</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button><button onClick={() => { setShowCustomGame(true); setAddGameStep("form"); setPendingGame(null); setLaunchType("file"); setLaunchTarget(""); }}><MochiIcon name="plus" fallback={Plus} size={18} /><span><strong>Add a custom game</strong><small>Save a name and executable path locally</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button></div></div></div>}
            {showCustomGame && <div className="modal-backdrop" onClick={() => setShowCustomGame(false)}>
        <form className="modal igdb-selection-modal" onSubmit={addCustomGame} onClick={(event) => event.stopPropagation()}>
          <div className="modal-header"><div><p className="eyebrow">{addGameStep === "igdb" ? "Confirm game identity" : "Local library"}</p><h2>{addGameStep === "igdb" ? "Is this the right game?" : "Add custom game"}</h2></div><button className="icon-button" type="button" onClick={() => { setShowCustomGame(false); setAddGameStep("form"); setPendingGame(null); setLaunchTarget(""); }}><MochiIcon name="close" fallback={X} size={17} /></button></div>
          {addGameStep === "form" ? <>
            <p className="modal-description">Choose how Mochi should launch this game. File selection uses the native Tauri file dialog, which is preferable to trying to use xdg-open as a file picker on Linux/Wayland.</p>
            <div className="form-fields">
              <label>Game name<input name="name" autoFocus placeholder="e.g. Hollow Knight" required /></label>
              <label>Platform category<input name="platformCategory" defaultValue={platformCategory} placeholder="e.g. Steam, Heroic, Custom" /></label>
              <label>Launch method
                <select value={launchType} onChange={(event) => setLaunchType(event.target.value as LaunchMethodId)}>
                  {(platformCapabilities?.launchMethods ?? ["file", "flatpak", "custom"]).map((method) => (
                    <option value={method} key={method}>{method === "file" ? "Choose file" : method === "app" ? "macOS application" : method === "flatpak" ? "Flatpak" : "Custom"}</option>
                  ))}
                </select>
              </label>
              {(launchType === "file" || launchType === "app") && <div className="launch-target-picker"><button type="button" className="secondary-button file-picker-button" onClick={chooseGameFile}>{launchType === "app" ? "Choose macOS application" : "Choose executable / launcher file"}</button></div>}
              {launchType === "flatpak" && <div className="flatpak-input-row"><button type="button" className="secondary-button" onClick={loadFlatpaks} disabled={flatpakBusy}>{flatpakBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={15} className="spin" /> Loading...</> : <><MochiIcon name="installed" fallback={Grid2X2} size={15} /> Choose installed Flatpak</>}</button><input value={launchTarget} onChange={(event) => setLaunchTarget(event.target.value)} placeholder="org.company.game" autoComplete="off" required /></div>}
              {launchType === "custom" && <input value={launchTarget} onChange={(event) => setLaunchTarget(event.target.value)} placeholder="Custom path, Flatpak ID, or supported launch target" autoComplete="off" required />}
            </div>
            <button className="play-button form-submit" type="submit" disabled={igdbBusy}>{igdbBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={16} className="spin" /> Searching IGDB...</> : hasIgdb ? <>Next <MochiIcon name="chevron" fallback={ChevronDown} size={16} /></> : <><MochiIcon name="plus" fallback={Plus} size={16} /> Add game</>}</button>
          </> : <>
            <p className="modal-description">{pendingGame?.candidates.length ? "Mochi found these matches. Approve the best match to use its artwork, description and categories." : "Mochi could not find a confident match. You can add the game without IGDB metadata."}</p>
            <div className="igdb-candidates">{pendingGame?.candidates.map((game) => {
              const art = resolveIgdbImage(game.cover?.url, "t_cover_big") || resolveIgdbImage(game.artworks?.[0]?.url, "t_720p");
              return <button type="button" className="igdb-candidate" key={game.id ?? game.name} onClick={() => approveIgdbGame(game)}><div className="igdb-candidate-art" style={{ backgroundImage: art ? `url('${art}')` : undefined }} /><div className="igdb-candidate-copy"><strong>{game.name}</strong><small>{game.genres?.map((g) => g.name).join(" · ") || "Genre unknown"}</small>{game.summary && <p>{game.summary}</p>}</div><MochiIcon name="chevron" fallback={ChevronDown} size={16} /></button>;
            })}</div>
            <div className="igdb-selection-actions"><button type="button" className="secondary-button" onClick={() => setAddGameStep("form")}>Back</button><button type="button" className="play-button" onClick={() => approveIgdbGame(null)}>Add without IGDB</button></div>
          </>}
        </form>
      </div>}
      {flatpakPickerOpen && <div className="modal-backdrop" onClick={() => setFlatpakPickerOpen(false)}>
        <div className="modal flatpak-picker-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header"><div><p className="eyebrow">Installed applications</p><h2>Choose a Flatpak</h2></div><button className="icon-button" type="button" onClick={() => setFlatpakPickerOpen(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div>
          <p className="modal-description">Games are shown first. Everything else is grouped separately.</p>
          {(["Games", "Other"] as const).map((category) => {
            const items = flatpaks.filter((flatpak) => flatpak.category === category);
            return items.length ? <section className="flatpak-group" key={category}><div className="flatpak-group-heading"><strong>{category}</strong><span>{items.length}</span></div><div className="flatpak-list">{items.map((flatpak) => <button type="button" className="flatpak-item" key={flatpak.id} onClick={() => {
              setLaunchTarget(`flatpak://${flatpak.id}`);
              setFlatpakPickerOpen(false);
            }}><span><strong>{flatpak.name}</strong><small>{flatpak.id}</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={15} /></button>)}</div></section> : null;
          })}
          {!flatpaks.length && <div className="empty-state flatpak-empty"><MochiIcon name="gamepad" fallback={Gamepad2} size={22} /><p>No installed Flatpaks were found.</p></div>}
        </div>
      </div>}
      {showImportPicker && <ImportPicker onClose={() => setShowImportPicker(false)} onImport={addImportedGames} />}
      {showAuth ? authModal : null}
    </div>
  );
}
export default App;
