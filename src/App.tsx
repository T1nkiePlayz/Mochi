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
import { enrollTotp, getVerifiedTotpFactor, registerPasskey, sendMagicLink, signInWithPasskey, signInWithProvider, verifyEmailToken, verifyMfaCode } from "./lib/auth";
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
    try { const stored = JSON.parse(window.localStorage.getItem(storedSettingsKey) || "{}"); return { launchOnStartup: Boolean(stored.launchOnStartup), keepOpen: stored.keepOpen !== false }; } catch { return { launchOnStartup: false, keepOpen: true }; }
  });
  const [igdbMessage, setIgdbMessage] = useState("");
  const [nexusApiKey, setNexusApiKey] = useState("");
  const [credentialStatus, setCredentialStatus] = useState({ igdb: false, nexus: false });
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
  const [showFirstLaunchSetup, setShowFirstLaunchSetup] = useState(() => window.localStorage.getItem(setupCompleteKey) !== "true");
  const [showImportPicker, setShowImportPicker] = useState(false);
  const [syncState, setSyncState] = useState<"offline" | "syncing" | "synced" | "error">(
    isCloudConfigured ? "offline" : "offline",
  );
  const syncInitialized = useRef(false);
  const { themes, theme, setTheme, reloadThemes, configInfo } = useThemeEngine();

  useEffect(() => {
    window.localStorage.setItem(storedPikosKey, JSON.stringify(library));
  }, [library]);
  useEffect(() => {
    window.localStorage.setItem(storedSettingsKey, JSON.stringify({ ...behavior }));
  }, [behavior]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    let unlisten: (() => void) | undefined;

    const handleDeepLinks = (urls: string[]) => {
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
    void supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
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
  const visiblePikos = useMemo(
    () => library.filter((piko) => piko.name.toLowerCase().includes(search.toLowerCase())),
    [library, search],
  );
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
    ]).then(([igdb, nexus]) => setCredentialStatus({ igdb, nexus })).catch((error) => {
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

  const handlePasskey = async () => {
    if (!supabase) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      await signInWithPasskey(supabase);
      setShowAuth(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Passkey sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const addPasskey = async () => {
    if (!supabase || !user) return;
    setAuthBusy(true);
    try {
      const { error } = await registerPasskey(supabase);
      if (error) throw error;
      setAuthNotice("Passkey added successfully.");
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Passkey registration failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const addAuthenticator = async () => {
    if (!supabase || !user) return;
    setAuthBusy(true);
    try {
      const { data, error } = await enrollTotp(supabase);
      if (error) throw error;
      if (data?.totp?.qr_code) {
        setAuthNotice("Scan the QR code returned by Supabase, then verify the code in the next step.");
        setMfaFactorId(data.id);
        setMfaMessage(data.totp.secret ? `Secret: ${data.totp.secret}` : "Authenticator factor created.");
      }
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : "Unable to enroll an authenticator.");
    } finally {
      setAuthBusy(false);
    }
  };

  const resetLocalData = () => {
    window.localStorage.removeItem(storedPikosKey);
    window.localStorage.removeItem(storedSettingsKey);
    window.localStorage.removeItem(setupCompleteKey);
    window.localStorage.removeItem(importSourcesKey);
    window.localStorage.removeItem("mochi:theme");
    window.location.reload();
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
        : await supabase.auth.signUp({ email, password });
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

  const authModal = <div className="modal-backdrop" onClick={() => setShowAuth(false)}><form className="modal auth-modal" onSubmit={authenticate} onClick={(event) => event.stopPropagation()}><div className="modal-header"><div className="auth-brand"><img src="/mochi.png" alt="Mochi" /><div><p className="eyebrow">Mochi Cloud</p><h2>{authMode === "sign-in" ? "Welcome back." : "Create your account."}</h2></div></div><button className="icon-button" type="button" onClick={() => setShowAuth(false)}><MochiIcon name="close" fallback={X} size={17} /></button></div><p className="modal-description">{authMode === "sign-in" ? "Sign in to access your securely stored API credentials and, if you enable it, keep Mochi metadata available across devices." : "Your games stay local. Your Mochi metadata can follow you."}</p><div className="form-fields"><label>Email<input name="email" type="email" placeholder="you@example.com" required /></label><label>Password<input name="password" type="password" minLength={6} placeholder="At least 6 characters" required /></label></div>{authError && <p className="auth-error">{authError}</p>} {mfaRequired ? <><p className="modal-description">{mfaMessage}</p><input className="mfa-input" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456" maxLength={6} /><button className="play-button form-submit" type="button" disabled={authBusy || mfaCode.length !== 6} onClick={completeMfa}>{authBusy ? "Verifying..." : "Verify code"}</button></> : <><button className="play-button form-submit" disabled={authBusy} type="submit">{authBusy ? "Connecting..." : authMode === "sign-in" ? "Sign in" : "Create account"}</button><div className="auth-provider-row"><button type="button" className="secondary-button" onClick={() => signInWithProvider(supabase!, "github")}><MochiIcon name="github" fallback={Github} size={15}/> GitHub</button><button type="button" className="secondary-button" onClick={handlePasskey}><MochiIcon name="key" fallback={KeyRound} size={15}/> Passkey</button></div><button type="button" className="switch-auth" onClick={() => sendMagicLink(supabase!, String((document.querySelector('input[name="email"]') as HTMLInputElement)?.value || ""))}>Email me a magic link</button><button className="switch-auth" type="button" onClick={() => { setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in"); setAuthError(""); }}>{authMode === "sign-in" ? "New to Mochi? Create an account" : "Already have an account? Sign in"}</button></>}</form></div>;

  if (showFirstLaunchSetup) {
    return <>
      <FirstLaunchSetup
        settings={settings}
        setSettings={setSettings}
        onSignIn={() => { setAuthMode("sign-in"); setAuthError(""); setShowAuth(true); }}
        signedIn={Boolean(user)}
        credentialStatus={credentialStatus}
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
        <button className="sidebar-account" onClick={user ? () => setActiveNav("Settings") : () => setShowAuth(true)}><AccountAvatar user={user} size={36} /><span><strong>{user?.user_metadata?.user_name || user?.user_metadata?.preferred_username || user?.email?.split("@")[0] || "Guest"}</strong><small>{user ? "Mochi account" : "Sign in to Mochi"}</small></span><MochiIcon name="chevron" fallback={ChevronDown} size={14} /></button>
        <div className="brand">
          <div className="brand-mark"><img src="/mochi.png" alt="Mochi" /></div>
          <div>
            <strong>Mochi</strong>
            <span>Your games, your way.</span>
          </div>
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
              {label === "Downloads" && <span className="nav-badge">2</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-section">
          <div className="section-label">
            <span>Your Pikos</span>
            <button className="icon-button tiny" aria-label="Add Piko" onClick={() => setShowAddPiko(true)}>
              <MochiIcon name="plus" fallback={Plus} size={14} />
            </button>
          </div>
          <div className="piko-list">
            {visiblePikos.map((piko) => (
              <button
                className={`piko-nav-item ${selectedPiko.id === piko.id ? "selected" : ""}`}
                key={piko.id}
                onClick={() => selectPiko(piko)}
              >
                <span className="piko-dot" style={{ background: piko.accent }} />
                <span>{piko.name}</span>
                <span className="tofu-count">{piko.tofus.length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-bottom">
          <button className={`nav-item ${activeNav === "Settings" ? "active" : ""}`} onClick={() => setActiveNav("Settings")}>
            <MochiIcon name="settings" fallback={Settings} size={17} strokeWidth={1.8} />
            <span>Settings</span>
          </button>
          <button className="sync-status" onClick={() => setShowAuth(true)}>
            <div className="status-icon"><MochiIcon name="offline" fallback={WifiOff} size={14} /></div>
            <div><strong>{user ? (syncState === "syncing" ? "Syncing..." : syncState === "error" ? "Sync error" : "Cloud ready") : "Local mode"}</strong><span>{user ? user.email : isCloudConfigured ? "Cloud sync is off" : "Connect Supabase to sync"}</span></div>
            <span className="icon-button tiny" aria-hidden="true"><MochiIcon name="chevron" fallback={ChevronDown} size={13} /></span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open menu"><MochiIcon name="menu" fallback={Menu} size={18} /></button>
          <div className="breadcrumb"><span>Library</span><span className="breadcrumb-slash">/</span><strong>{selectedPiko.name}</strong></div>
          <div className="topbar-actions">
            <label className="search-box">
              <MochiIcon name="search" fallback={Search} size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your library" />
              {search && <button className="clear-search" onClick={() => setSearch("")}><MochiIcon name="close" fallback={X} size={13} /></button>}
              {!search && <kbd>⌘ K</kbd>}
            </label>
            <button className="icon-button" aria-label="Notifications"><MochiIcon name="notifications" fallback={Bell} size={17} /></button>
            <button className="avatar-button" aria-label={user ? "Account menu" : "Sign in"} onClick={user ? () => setActiveNav("Settings") : () => setShowAuth(true)}><AccountAvatar user={user} size={34} /></button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading">
            <div><p className="eyebrow">Your collection</p><h1>{activeNav === "Library" ? "Good evening, Ashton." : activeNav}</h1></div>
            <button className="secondary-button" onClick={() => setShowAddPiko(true)}><MochiIcon name="plus" fallback={Plus} size={16} /> Add Piko</button>
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
                <div className="settings-group-heading"><strong>IGDB</strong><span>Global app setting</span></div>
                <div className="igdb-form">
                  <p>IGDB uses your Twitch developer application's Client ID and Client Secret. Mochi securely stores these credentials in your account and exchanges the secret for a temporary access token on the backend.</p>
                  <label>Client ID<input value={igdbClientId} onChange={(event) => setIgdbClientId(event.target.value)} placeholder="Your Twitch application Client ID" /></label>
                  <label>Client Secret<input type="password" value={igdbClientSecret} onChange={(event) => setIgdbClientSecret(event.target.value)} placeholder="Your Twitch application Client Secret" /></label>
                  <p className="metadata-note">You do not need to create or paste a bearer token or separate API key. Your Twitch application name is only an identifier in the Twitch developer dashboard.</p>
                  <p className="metadata-note">Sign in to Mochi before saving. New games can then use IGDB for artwork, descriptions, genres, and release information without exposing your Client Secret to the launcher.</p>
                  {igdbMessage && <small className="metadata-note">{igdbMessage}</small>}
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>Mod & metadata providers</strong><span>Credentials are encrypted with Supabase Vault</span></div>
                <div className="provider-credential-card">
                  <div className="provider-credential-heading"><div><strong>IGDB</strong><small>Store your Twitch Client ID and Client Secret securely with your Mochi account.</small></div><span className={credentialStatus.igdb ? "credential-status saved" : "credential-status"}>{credentialStatus.igdb ? "Saved" : "Not saved"}</span></div>
                  <button className="secondary-button" onClick={() => void saveCredential("igdb")} disabled={credentialBusy !== null}>{credentialBusy === "igdb" ? <><MochiIcon name="refresh" fallback={RefreshCw} size={14} className="spin" /> Saving...</> : <><MochiIcon name="cloud" fallback={Cloud} size={14} /> Save IGDB securely</>}</button>
                </div>
                <div className="provider-credential-card">
                  <div className="provider-credential-heading"><div><strong>Nexus Mods</strong><small>Your Nexus API key is stored server-side and is never returned to the launcher.</small></div><span className={credentialStatus.nexus ? "credential-status saved" : "credential-status"}>{credentialStatus.nexus ? "Saved" : "Not saved"}</span></div>
                  <input type="password" value={nexusApiKey} onChange={(event) => setNexusApiKey(event.target.value)} placeholder={credentialStatus.nexus ? "Enter a new key to replace the saved key" : "Paste your Nexus Mods API key"} />
                  <button className="secondary-button" onClick={() => void saveCredential("nexus")} disabled={credentialBusy !== null || nexusApiKey.trim().length < 8}>{credentialBusy === "nexus" ? "Saving..." : "Save Nexus key securely"}</button>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>General</strong><span>Launcher behavior</span></div>
                <label className="setting-row"><span><strong>Launch Mochi on startup</strong><small>Open the launcher when you sign in to your computer.</small></span><input className="toggle" checked={behavior.launchOnStartup} onChange={(event) => setBehavior({ ...behavior, launchOnStartup: event.target.checked })} type="checkbox" /></label>
                <label className="setting-row"><span><strong>Keep launcher open</strong><small>Minimize to the system tray when a game starts.</small></span><input className="toggle" checked={behavior.keepOpen} onChange={(event) => setBehavior({ ...behavior, keepOpen: event.target.checked })} type="checkbox" /></label>
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>Security</strong><span>Protect your Mochi account</span></div>
                {user && <div className="security-actions"><button className="secondary-button" onClick={addPasskey} disabled={authBusy}><MochiIcon name="key" fallback={KeyRound} size={15}/> Add passkey</button><button className="secondary-button" onClick={addAuthenticator} disabled={authBusy}><MochiIcon name="security" fallback={ShieldCheck} size={15}/> Enable authenticator</button>{authNotice && <small className="metadata-note">{authNotice}</small>}{mfaMessage && <small className="metadata-note">{mfaMessage}</small>}</div>}
              </div>
              <div className="settings-group">
                <div className="settings-group-heading"><strong>Data & privacy</strong><span>Local-first storage</span></div>
                <div className="setting-row"><span><strong>Library location</strong><small>Your game metadata is saved in this browser profile.</small></span><code>~/.config/mochi</code></div>
                <button className="setting-row setting-button" onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}><span><strong>Advanced settings</strong><small>Diagnostics and developer options.</small></span><MochiIcon name="chevron" fallback={ChevronDown} className={showAdvancedSettings ? "rotate" : ""} size={16} /></button>
                {showAdvancedSettings && <div className="advanced-note">Native game detection and process controls will appear here when the Tauri backend is connected.</div>}
              </div>
              <button className="reset-button" onClick={resetLocalData}>Reset local library and settings</button>
            </section>
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
