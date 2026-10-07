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
} from "lucide-react";

function GoogleIcon({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.35 12.27c0-.71-.06-1.39-.18-2.04H12v3.86h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.21Z"/><path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.93-3.31.93-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.6Z"/><path fill="#FBBC05" d="M6.54 13.69A5.84 5.84 0 0 1 6.23 12c0-.59.11-1.16.31-1.69V7.78H3.3A9.72 9.72 0 0 0 2.27 12c0 1.57.38 3.05 1.03 4.22l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.28c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.83 3.3 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.7 5.38l3.24 2.53C7.31 8 9.46 6.28 12 6.28Z"/></svg>;
}
import { AccountAvatar } from "./components/AccountAvatar";
import { ModrinthManager } from "./components/ModrinthManager";
import { MochiIcon } from "./components/MochiIcon";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { FirstLaunchSetup } from "./components/FirstLaunchSetup";
import { ImportPicker } from "./components/ImportPicker";
import type { ImportedGame, ImportSourceId } from "./lib/sources";
import { isCloudConfigured, supabase } from "./lib/supabase";
import { pullLibrary, pushLibrary } from "./lib/cloud";
import type { Piko, Tofu } from "./models";
import { lookupIgdbGame, lookupIgdbGames, type IgdbGame, type IgdbSettings } from "./lib/igdb";
import {
  chooseGameTarget,
  getPlatformCapabilities,
  launchGame as launchGameTarget,
  listInstalledFlatpaks,
  normalizeLaunchTarget,
  type FlatpakApp,
  type LaunchMethodId,
  type PlatformCapabilities,
} from "./lib/platform";
import { deletePasskey, enrollTotp, getVerifiedTotpFactor, linkAuthIdentity, listPasskeys, registerPasskey, removeTotp, sendEmailCode, signInWithProvider, verifyEmailCode, verifyEmailToken, verifyMfaCode } from "./lib/auth";
import { importThemeFile, importThemeFolder, useThemeEngine } from "./lib/theme";
import { getProviderCredentialStatus, saveProviderCredential } from "./lib/providerCredentials";

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
function App() {
  const [library, setLibrary] = useState<Piko[]>(() => {
    try {
      const stored = window.localStorage.getItem(storedPikosKey);
      return stored ? (JSON.parse(stored) as Piko[]) : [];
    } catch {
      return [];
    }
  });
  const [activeNav, setActiveNav] = useState("Library");
  const [selectedPikoId, setSelectedPikoId] = useState("");
  const [selectedTofuId, setSelectedTofuId] = useState("");
  const [search, setSearch] = useState("");
  const [showAddPiko, setShowAddPiko] = useState(false);
  const [showNewTofu, setShowNewTofu] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<Array<{ id: string; username: string; email: string; refreshToken: string }>>(() => { try { return (JSON.parse(window.localStorage.getItem("mochi:accounts") || "[]") as Array<{ id: string; username: string; email: string; refreshToken: string }>).slice(0, 5); } catch { return []; } });
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string; createdAt: number }>>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showCustomGame, setShowCustomGame] = useState(false);
  const [addGameStep, setAddGameStep] = useState<"form" | "igdb">("form");
  const [pendingGame, setPendingGame] = useState<{ name: string; executablePath: string; candidates: IgdbGame[] } | null>(null);
  const [launchType, setLaunchType] = useState<LaunchMethodId>("file");
  const [launchTarget, setLaunchTarget] = useState("");
  const [platformCapabilities, setPlatformCapabilities] = useState<PlatformCapabilities | null>(null);
  const [flatpakPickerOpen, setFlatpakPickerOpen] = useState(false);
  const [flatpaks, setFlatpaks] = useState<FlatpakApp[]>([]);
  const [flatpakBusy, setFlatpakBusy] = useState(false);
  const [settings, setSettings] = useState<IgdbSettings>({ clientId: "", clientSecret: "" });
  const [behavior, setBehavior] = useState(() => {
    try { const stored = JSON.parse(window.localStorage.getItem(storedSettingsKey) || "{}"); return { launchOnStartup: Boolean(stored.launchOnStartup), keepOpen: stored.keepOpen !== false, confirmLaunch: stored.confirmLaunch !== false, detailedErrors: Boolean(stored.detailedErrors), experimentalFeatures: Boolean(stored.experimentalFeatures) }; } catch { return { launchOnStartup: false, keepOpen: true, confirmLaunch: true, detailedErrors: false, experimentalFeatures: false }; }
  });
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
  const [syncState, setSyncState] = useState<"offline" | "syncing" | "synced" | "error">(
    isCloudConfigured ? "offline" : "offline",
  );
  const syncInitialized = useRef(false);
  const { themes, theme, setTheme, reloadThemes, configInfo } = useThemeEngine();
  const currentUsername = user?.user_metadata?.username || user?.user_metadata?.user_name || user?.user_metadata?.preferred_username || user?.email || "Guest";
  const pushNotification = (title: string, message: string) => {
    const notification = { id: crypto.randomUUID(), title, message, createdAt: Date.now() };
    setNotifications((current) => [notification, ...current].slice(0, 20));
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("send_system_notification", { title, body: message })).catch(() => {});
  };
  const saveAccountSession = (sessionUser: User, refreshToken: string) => {
    const account = { id: sessionUser.id, username: sessionUser.user_metadata?.username || sessionUser.user_metadata?.user_name || sessionUser.user_metadata?.preferred_username || sessionUser.email || "Guest", email: sessionUser.email || "", refreshToken };
    setSavedAccounts((current) => { const next = [account, ...current.filter((item) => item.id !== account.id)].slice(0, 5); window.localStorage.setItem("mochi:accounts", JSON.stringify(next)); return next; });
  };
  const switchAccount = async (account: { id: string; username: string; email: string; refreshToken: string }) => {
    if (!supabase || account.id === user?.id) { setShowAccountMenu(false); return; }
    setAuthBusy(true);
    try { const { error } = await supabase.auth.setSession({ access_token: "", refresh_token: account.refreshToken }); if (error) throw error; setShowAccountMenu(false); pushNotification("Account switched", "Now using " + account.username + "."); }
    catch (error) { setAuthError(error instanceof Error ? error.message : "Unable to switch accounts."); setShowAccountMenu(false); setShowAuth(true); }
    finally { setAuthBusy(false); }
  };
  const addAccount = () => { setShowAccountMenu(false); setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); };

  useEffect(() => {
    window.localStorage.setItem(storedPikosKey, JSON.stringify(library));
  }, [library]);
  useEffect(() => {
    window.localStorage.setItem(storedSettingsKey, JSON.stringify({ ...behavior }));
  }, [behavior]);

  useEffect(() => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_launch_on_startup", { enabled: behavior.launchOnStartup })).catch(() => { /* browser/development mode */ });
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
    if (!supabase || !user) {
      syncInitialized.current = false;
      setSyncState("offline");
      return;
    }

    let cancelled = false;
    const client = supabase;
    setSyncState("syncing");
    void pullLibrary(client, user.id)
      .then(async (cloudLibrary) => {
        if (cancelled) return;
        if (cloudLibrary.length) {
          setLibrary(cloudLibrary);
        } else {
          await pushLibrary(client, user.id, library);
        }
        syncInitialized.current = true;
        setSyncState("synced");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Mochi cloud sync failed", error);
        setSyncState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!supabase || !user || !syncInitialized.current) return;
    const client = supabase;
    setSyncState("syncing");
    void pushLibrary(client, user.id, library)
      .then(() => setSyncState("synced"))
      .catch((error: unknown) => {
        console.error("Mochi cloud sync failed", error);
        setSyncState("error");
      });
  }, [library, user]);

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
    const query = search.trim().toLowerCase();
    if (!query) return library;
    return library.filter((piko) => [piko.name, piko.description, ...(piko.categories ?? [])].some((value) => value?.toLowerCase().includes(query)));
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
      const category = piko.categories?.[0] || "Other";
      groups.set(category, [...(groups.get(category) ?? []), piko]);
    });
    return [...groups.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [visiblePikos]);

  const selectPiko = (piko: Piko) => {
    setSelectedPikoId(piko.id);
    setSelectedTofuId(piko.tofus[0].id);
  };

  const updateSelectedTofu = (patch: Partial<Tofu>) => {
    setLibrary(current => current.map(piko => piko.id === selectedPiko.id ? { ...piko, tofus: piko.tofus.map(tofu => tofu.id === selectedTofu.id ? { ...tofu, ...patch } : tofu) } : piko));
  };

  const launchGame = async () => {
    if (selectedPiko.id === "__empty" || !selectedPiko.executablePath) {
      setLaunchError("This game does not have an executable path. Add or edit the game to set its executable.");
      return;
    }
    setLaunchError("");
    setIsLaunching(true);
    try { await launchGameTarget(selectedPiko.executablePath); }
    catch (error) { setLaunchError(error instanceof Error ? error.message : String(error)); }
    finally { setIsLaunching(false); }
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
      const selected = await chooseGameTarget();
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

  const addGameToLibrary = (name: string, executablePath: string, metadata: IgdbGame | null) => {
    const artworkUrl = metadata?.cover?.url?.replace("t_thumb", "t_1080p") || metadata?.artworks?.[0]?.url?.replace("t_thumb", "t_1080p");
    const piko: Piko = {
      id: `custom-${Date.now()}`, name: metadata?.name || name, executablePath, source: "custom",
      categories: metadata?.genres?.map((genre) => genre.name) ?? ["Other"],
      description: metadata?.summary || "Custom game added to your local library.",
      accent: "#a99ad6", artworkUrl,
      artwork: artworkUrl ? `linear-gradient(145deg, rgba(10,15,20,.12), rgba(11,15,20,.88)), url('${artworkUrl}')` : "linear-gradient(145deg, rgba(73,57,103,.35), rgba(20,16,29,.96))",
      tofus: [{ id: "default", name: "Default", version: "Local", runtime: "Native", mods: 0, status: "Ready" }],
    };
    setLibrary((current) => [...current, piko]);
    setSelectedPikoId(piko.id);
    setSelectedTofuId("default");
    setPendingGame(null);
    setAddGameStep("form");
    setShowCustomGame(false);
    setShowAddPiko(false);
  };

  const addImportedGames = (games: ImportedGame[]) => {
    const now = Date.now();
    setLibrary((current) => {
      const next = [...current];
      for (const imported of games) {
        const duplicate = next.find((piko) => piko.name.trim().toLowerCase() === imported.name.trim().toLowerCase());
        if (duplicate) continue;
        const piko: Piko = {
          id: `imported-${imported.source}-${imported.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${now}`,
          name: imported.name,
          description: `Imported from ${imported.source}. The original launcher remains responsible for the installation and runtime.`,
          accent: "#a99ad6",
          artwork: "linear-gradient(145deg, rgba(73,57,103,.35), rgba(20,16,29,.96))",
          executablePath: imported.launchTarget,
          source: "custom",
          sourceId: imported.source,
          categories: ["Other"],
          tofus: [{ id: "default", name: "Default", version: "Imported", runtime: imported.source, mods: 0, status: "Ready" }],
        };
        next.push(piko);
      }
      return next;
    });
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
      setPendingGame({ name, executablePath, candidates });
      setAddGameStep("igdb");
    } catch (error) {
      console.warn("IGDB lookup failed", error);
      setPendingGame({ name, executablePath, candidates: [] });
      setAddGameStep("igdb");
    } finally {
      setIgdbBusy(false);
    }
  };

  const hasIgdb = Boolean(igdbClientId.trim() && igdbClientSecret.trim());

  const approveIgdbGame = (metadata: IgdbGame | null) => {
    if (!pendingGame) return;
    addGameToLibrary(pendingGame.name, pendingGame.executablePath, metadata);
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
      const artworkUrl = result.cover?.url?.replace("t_thumb", "t_1080p") || result.artworks?.[0]?.url?.replace("t_thumb", "t_1080p");
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
    try { await import("@tauri-apps/api/core").then(({ invoke }) => invoke("clear_mochi_app_data")); } catch { /* browser/development mode */ }
    window.location.reload();
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
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("open_external_url", { url: "https://t1nkieplayz.github.io/Mochi-Website/#/signin?app=mochi" })
    ).catch((error) => setAuthError(error instanceof Error ? error.message : "Unable to open the Mochi website."));
  };

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
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
    setAuthBusy(false);
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  const authModal = <div className="modal-backdrop" onClick={() => setShowAuth(false)}><form className="modal auth-modal" onSubmit={authenticate} onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><div className="auth-brand"><img src="/mochi.png" alt="Mochi" /><div><p className="eyebrow">Mochi Cloud</p><h2>{emailCodeStep ? "Check your email." : authMode === "sign-in" ? "Welcome back." : "Create your account."}</h2></div></div><button className="icon-button" type="button" onClick={() => setShowAuth(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div>
    {emailCodeStep ? <>
      <p className="modal-description">We sent a six-digit verification code to <strong>{emailCodeEmail}</strong>. Enter it below to finish signing in.</p>
      <div className="form-fields"><label>Verification code<input className="mfa-input" inputMode="numeric" autoComplete="one-time-code" value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\\D/g, "").slice(0, 6))} placeholder="123456" maxLength={6} /></label></div>
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
          {showAccountMenu && <div className="account-menu">{savedAccounts.map((account) => <button type="button" key={account.id} className={account.id === user?.id ? "selected" : ""} onClick={() => void switchAccount(account)}><span className="account-menu-avatar">{account.username.slice(0, 1).toUpperCase()}</span><span><strong>{account.username}</strong><small>{account.email}</small></span></button>)}{!user && <button type="button" className="account-menu-add" onClick={addAccount}><Plus size={14} /><span><strong>Sign in</strong><small>Add a Mochi account</small></span></button>}{user && savedAccounts.length < 5 && <button type="button" className="account-menu-add" onClick={addAccount}><Plus size={14} /><span><strong>Add User</strong><small>Sign in to another Mochi account</small></span></button>}{user && <button type="button" className="account-menu-add" onClick={signOut}><span className="account-menu-avatar">↪</span><span><strong>Sign out</strong><small>Keep local Mochi data</small></span></button>}</div>}
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => (
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
            <div className="notification-wrap"><button className="icon-button" aria-label="Notifications" aria-expanded={showNotifications} onClick={() => setShowNotifications((open) => !open)}><MochiIcon name="notifications" fallback={Bell} size={17} />{notifications.length > 0 && <span className="notification-dot" />}</button>{showNotifications && <div className="notification-popover"><div className="notification-heading"><strong>Notifications</strong>{notifications.length > 0 && <button type="button" onClick={() => setNotifications([])}>Clear</button>}</div>{notifications.length ? notifications.map((item) => <div className="notification-item" key={item.id}><strong>{item.title}</strong><span>{item.message}</span></div>) : <div className="notification-empty">You’re all caught up.</div>}</div>}</div>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div><p className="eyebrow">Your collection</p><h1>{activeNav === "Library" ? "Good evening, Ashton." : activeNav}</h1></div>
            {activeNav === "Library" && <button className="secondary-button" onClick={() => setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> Add Piko</button>}
          </section>

          {activeNav === "Library" && library.length === 0 ? (
            <div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>Your Mochi library is empty.</h2><p>Mochi starts clean. Add a game when you are ready.</p><button className="secondary-button" onClick={() => setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> Add Piko</button></div>
          ) : activeNav === "Library" ? (
            <>
              <section className="library-grid-view">
                {groupedPikos.map(([category, games]) => <div className="library-category" key={category}><div className="section-heading"><div><p className="eyebrow">Category</p><h3>{category}</h3></div><span className="category-count">{games.length} game{games.length === 1 ? "" : "s"}</span></div><div className="game-card-grid">{games.map((piko) => <button className={`game-card ${selectedPiko.id === piko.id ? "selected" : ""}`} key={piko.id} onClick={() => selectPiko(piko)}><div className="game-card-art" style={{ backgroundImage: piko.artwork }}><span className="game-card-play"><MochiIcon name="play" fallback={Play} size={15} fill="currentColor"/></span></div><div className="game-card-copy"><strong>{piko.name}</strong><small>{piko.categories?.join(" · ") || "Other"}</small></div></button>)}</div></div>)}
              </section>
              <section className="hero-card" style={{ backgroundImage: selectedPiko.artwork }}>
                <div className="hero-copy">
                  <span className="hero-kicker"><span className="live-dot" /> Last played recently</span>
                  <h2>{selectedPiko.name}</h2>
                  <p>{selectedPiko.description}</p>
                  <div className="hero-actions">
                    <button className="play-button" onClick={launchGame}><MochiIcon name="play" fallback={Play} size={16} fill="currentColor" /> {isLaunching ? "Launching..." : "Play"}</button>
                    {selectedPiko.source === "custom" && <span className="metadata-note">{selectedPiko.executablePath}</span>}
                    <button className="icon-button dark-button" aria-label="More options"><MochiIcon name="more" fallback={MoreHorizontal} size={19} /></button>{launchError && <span className="metadata-note">{launchError}</span>}
                  </div>
                </div>
                <div className="hero-meta"><span>Last played</span><strong>Yesterday, 8:42 PM</strong></div>
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
                <div><span className="detail-label">Install location</span><strong className="path-text">{selectedTofu.path || "~/Games/" + selectedPiko.name.replace(" ", "")}</strong></div>
                <button className="icon-button"><MochiIcon name="settings" fallback={Settings} size={16} /></button>
              </section>

              <ModrinthManager tofu={selectedTofu} onPathChange={(path) => updateSelectedTofu({ path })} />
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
                  {user && <div className="provider-credential-card">
                    <div className="provider-credential-heading"><div><strong>IGDB</strong><small>Store your Twitch Client ID and Client Secret securely with your Mochi account.</small></div><span className={credentialStatus.igdb ? "credential-status saved" : "credential-status"}>{credentialStatus.igdb ? "Saved" : "Not saved"}</span></div>
                    <div className="provider-fields"><input value={igdbClientId} onChange={(event) => setIgdbClientId(event.target.value)} placeholder="Twitch Client ID" /><input type="password" value={igdbClientSecret} onChange={(event) => setIgdbClientSecret(event.target.value)} placeholder="Twitch Client Secret" /></div>
                    <button className="secondary-button" onClick={() => void saveCredential("igdb")} disabled={credentialBusy !== null}>{credentialBusy === "igdb" ? "Saving..." : "Save IGDB securely"}</button>
                    {igdbMessage && <small className="metadata-note">{igdbMessage}</small>}
                  </div>}
                  <div className="provider-credential-card">
                    <div className="provider-credential-heading"><div><strong>Nexus Mods</strong><small>Your Nexus API key is stored server-side and is never returned to the launcher.</small></div><span className={credentialStatus.nexus ? "credential-status saved" : "credential-status"}>{credentialStatus.nexus ? "Saved" : "Not saved"}</span></div>
                    {user ? <><input type="password" value={nexusApiKey} onChange={(event) => setNexusApiKey(event.target.value)} placeholder={credentialStatus.nexus ? "Enter a new key to replace the saved key" : "Paste your Nexus Mods API key"} /><button className="secondary-button" onClick={() => void saveCredential("nexus")} disabled={credentialBusy !== null || nexusApiKey.trim().length < 8}>{credentialBusy === "nexus" ? "Saving..." : "Save Nexus securely"}</button></> : <button className="secondary-button" onClick={() => { setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); }}><MochiIcon name="account" fallback={UserRound} size={14} /> Sign in to save</button>}
                  </div>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>General</strong><span>Launcher behavior</span></div>
                <label className="setting-row"><span><strong>Launch Mochi on startup</strong><small>Open the launcher when you sign in to your computer.</small></span><input className="toggle" checked={behavior.launchOnStartup} onChange={(event) => setBehavior({ ...behavior, launchOnStartup: event.target.checked })} type="checkbox" /></label>
                <label className="setting-row"><span><strong>Keep launcher open</strong><small>Minimize to the system tray when a game starts.</small></span><input className="toggle" checked={behavior.keepOpen} onChange={(event) => setBehavior({ ...behavior, keepOpen: event.target.checked })} type="checkbox" /></label>
              </div>
              <div className="settings-group security-settings-group">
                <div className="settings-group-heading"><strong>Security</strong><span>Account protection and sign-in methods</span></div>
                {user ? <div className="security-settings">
                  <div className="security-card"><div className="security-card-icon"><MochiIcon name="security" fallback={ShieldCheck} size={18}/></div><div className="security-card-copy"><strong>Authenticator app</strong><small>{securityFactors.some((factor) => factor.status === "verified") ? "Two-factor authentication is enabled." : "Use a time-based one-time password for an extra layer of protection."}</small></div><span className={securityFactors.some((factor) => factor.status === "verified") ? "credential-status saved" : "credential-status"}>{securityFactors.some((factor) => factor.status === "verified") ? "Enabled" : "Not configured"}</span></div>
                  {mfaSetup ? <div className="mfa-setup-card"><div><strong>Set up your authenticator</strong><small>Scan this QR code in your authenticator app.</small></div><img src={mfaSetup.qr} alt="Authenticator setup QR code" /><code>{mfaSetup.secret}</code><div className="mfa-setup-actions"><input className="mfa-input" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6}/><button className="secondary-button" disabled={securityBusy || mfaCode.length !== 6} onClick={() => void verifyAuthenticatorSetup()}>Verify</button><button className="secondary-button" disabled={securityBusy} onClick={() => { setMfaSetup(null); setMfaCode(""); }}>Cancel</button></div></div> : <div className="security-actions"><button className="secondary-button" onClick={() => void addAuthenticator()} disabled={securityBusy}>{securityFactors.some((factor) => factor.status === "verified") ? "Add another authenticator" : "Set up authenticator"}</button>{securityFactors.filter((factor) => factor.status === "verified").map((factor) => <button key={factor.id} className="secondary-button danger-outline" disabled={securityBusy} onClick={() => void removeAuthenticator(factor.id)}>Remove authenticator</button>)}</div>}
                  <div className="security-card"><div className="security-card-icon"><Github size={18}/></div><div className="security-card-copy"><strong>Connected accounts</strong><small>Google and GitHub identities linked to this Mochi account.</small></div></div>
                  <div className="security-provider-grid">{(["google","github"] as const).map((provider) => { const connected = (user.identities ?? []).some((identity) => identity.provider === provider); return <button type="button" key={provider} className="security-provider" onClick={() => { if (supabase && !connected) void linkAuthIdentity(supabase, provider); }} disabled={connected || securityBusy}><strong>{provider === "google" ? "Google" : "GitHub"}</strong><span>{connected ? "Connected" : "Connect"}</span></button>; })}</div>
                  <div className="security-card"><div className="security-card-icon"><KeyRound size={18}/></div><div className="security-card-copy"><strong>Passkeys</strong><small>Use a device, password manager, biometrics, or security key instead of a password.</small></div></div>
                  <div className="passkey-list">{passkeys.length ? passkeys.map((passkey) => <div className="passkey-row" key={passkey.id}><span><strong>{passkey.friendly_name || "Mochi passkey"}</strong><small>Added {passkey.created_at ? new Date(passkey.created_at).toLocaleDateString() : "recently"}</small></span><button className="secondary-button danger-outline" disabled={securityBusy} onClick={() => void removePasskey(passkey.id)}>Remove</button></div>) : <small className="metadata-note">No passkeys registered yet.</small>}<button className="secondary-button" disabled={securityBusy} onClick={() => void addPasskey()}>{securityBusy ? "Working..." : "Set up a passkey"}</button></div>
                  {authNotice && <small className="metadata-note security-notice">{authNotice}</small>}
                </div> : <div className="security-signed-out"><ShieldCheck size={18}/><span>Sign in to manage authenticator, connected-account, and passkey settings.</span><button className="secondary-button" onClick={() => { setAuthMode("sign-in"); setShowAuth(true); }}>Sign in</button></div>}
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>Data & privacy</strong><span>Local-first storage</span></div>
                <div className="setting-row"><span><strong>Library location</strong><small>Your game metadata is saved in this browser profile.</small></span><code>~/.config/Mochi</code></div>
                <button className="setting-row setting-button" onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}><span><strong>Advanced settings</strong><small>Diagnostics and experimental launcher controls.</small></span><MochiIcon name="chevron" fallback={ChevronDown} className={showAdvancedSettings ? "rotate" : ""} size={16} /></button>
                {showAdvancedSettings && <div className="advanced-settings">
                  <label className="setting-row"><span><strong>Confirm before launching</strong><small>Ask before starting a game.</small></span><input className="toggle" checked={behavior.confirmLaunch} onChange={(event) => setBehavior({ ...behavior, confirmLaunch: event.target.checked })} type="checkbox" /></label>
                  <label className="setting-row"><span><strong>Detailed launch errors</strong><small>Show extra information when a game fails to launch.</small></span><input className="toggle" checked={behavior.detailedErrors} onChange={(event) => setBehavior({ ...behavior, detailedErrors: event.target.checked })} type="checkbox" /></label>
                  <label className="setting-row"><span><strong>Experimental features</strong><small>Show unfinished launcher features as they become available.</small></span><input className="toggle" checked={behavior.experimentalFeatures} onChange={(event) => setBehavior({ ...behavior, experimentalFeatures: event.target.checked })} type="checkbox" /></label>
                </div>}
              </div>
              <button className="reset-button" onClick={resetLocalData}>Clear all Mochi app data</button>
            </section>
          ) : activeNav === "Downloads" ? (
            <section className="downloads-page"><div className="downloads-intro"><p className="eyebrow">Activity</p><h2>Downloads</h2><p>Downloads from game content providers will appear here. This will become the central queue for mods, resource packs, shaders, and game files.</p></div><div className="download-empty"><div className="empty-icon"><MochiIcon name="downloads" fallback={Download} size={22} /></div><h3>No active downloads</h3><p>Nothing is downloading right now.</p></div></section>
          ) : (
            <div className="empty-state"><div className="empty-icon"><MochiIcon name="gamepad" fallback={Gamepad2} size={23} /></div><h2>{activeNav} is ready when you are.</h2><p>This part of Mochi is taking shape. Your local library remains available offline.</p><button className="secondary-button" onClick={() => setActiveNav("Library")}><MochiIcon name="library" fallback={Library} size={16} /> Back to library</button></div>
          )}
          <footer><span>Mochi v0.1.0 · Local-first by design</span><span><MochiIcon name="cloud" fallback={Cloud} size={13} /> Cloud sync unavailable</span></footer>
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
              <label>Launch method
                <select value={launchType} onChange={(event) => setLaunchType(event.target.value as LaunchMethodId)}>
                  {(platformCapabilities?.launchMethods ?? ["file", "flatpak", "custom"]).map((method) => (
                    <option value={method} key={method}>{method === "file" ? "Choose file" : method === "flatpak" ? "Flatpak" : "Custom"}</option>
                  ))}
                </select>
              </label>
              {launchType === "file" && <div className="launch-target-picker"><button type="button" className="secondary-button file-picker-button" onClick={chooseGameFile}>Choose executable / launcher file</button></div>}
              {launchType === "flatpak" && <div className="flatpak-input-row"><button type="button" className="secondary-button" onClick={loadFlatpaks} disabled={flatpakBusy}>{flatpakBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={15} className="spin" /> Loading...</> : <><MochiIcon name="installed" fallback={Grid2X2} size={15} /> Choose installed Flatpak</>}</button><input value={launchTarget} onChange={(event) => setLaunchTarget(event.target.value)} placeholder="org.company.game" autoComplete="off" required /></div>}
              {launchType === "custom" && <input value={launchTarget} onChange={(event) => setLaunchTarget(event.target.value)} placeholder="Custom path, Flatpak ID, or supported launch target" autoComplete="off" required />}
            </div>
            <button className="play-button form-submit" type="submit" disabled={igdbBusy}>{igdbBusy ? <><MochiIcon name="refresh" fallback={RefreshCw} size={16} className="spin" /> Searching IGDB...</> : hasIgdb ? <>Next <MochiIcon name="chevron" fallback={ChevronDown} size={16} /></> : <><MochiIcon name="plus" fallback={Plus} size={16} /> Add game</>}</button>
          </> : <>
            <p className="modal-description">{pendingGame?.candidates.length ? "Mochi found these matches. Approve the best match to use its artwork, description and categories." : "Mochi could not find a confident match. You can add the game without IGDB metadata."}</p>
            <div className="igdb-candidates">{pendingGame?.candidates.map((game) => {
              const art = game.cover?.url?.replace("t_thumb", "t_1080p") || game.artworks?.[0]?.url?.replace("t_thumb", "t_1080p");
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
