import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Gamepad2, KeyRound, Library, LoaderCircle, LogIn, RefreshCw, Sparkles, UserRound } from "lucide-react";
import type { ThemeDescriptor } from "../lib/theme";
import { detectImportSources, scanImportGames, type DetectedImportSource, type ImportSourceId, type ImportedGame } from "../lib/sources";

type SetupProps = {
  igdbClientId: string;
  setIgdbClientId: (value: string) => void;
  igdbClientSecret: string;
  setIgdbClientSecret: (value: string) => void;
  onSignIn: () => void;
  signedIn: boolean;
  credentialStatus: { igdb: boolean; nexus: boolean };
  credentialStatusLoaded: boolean;
  themes: ThemeDescriptor[];
  theme: string;
  setTheme: (themeId: string) => Promise<void>;
  nexusApiKey: string;
  setNexusApiKey: (value: string) => void;
  saveCredential: (provider: "igdb" | "nexus") => Promise<void>;
  credentialBusy: "igdb" | "nexus" | null;
  onFinish: (games: ImportedGame[], sources: ImportSourceId[]) => void;
};port { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Gamepad2, KeyRound, Library, LoaderCircle, LogIn, RefreshCw, Sparkles, UserRound } from "lucide-react";
import type { ThemeDescriptor } from "../lib/theme";
import { detectImportSources, scanImportGames, type DetectedImportSource, type ImportSourceId, type ImportedGame } from "../lib/sources";

type SetupProps = {
  settings: IgdbSettings;
  setSettings: (settings: IgdbSettings) => void;
  onSignIn: () => void;
  signedIn: boolean;
  credentialStatus: { igdb: boolean; nexus: boolean };
  nexusApiKey: string;
  setNexusApiKey: (value: string) => void;
  saveCredential: (provider: "igdb" | "nexus") => Promise<void>;
  credentialBusy: "igdb" | "nexus" | null;
  onFinish: (games: ImportedGame[], sources: ImportSourceId[]) => void;
};

const steps = ["welcome", "theme", "account", "igdb", "imports"] as const;
type Step = typeof steps[number];

const platformImages: Record<ImportSourceId, string> = {
  flatpak: "https://cdn.simpleicons.org/flatpak",
  steam: "https://cdn.simpleicons.org/steam",
  heroic: "https://cdn.simpleicons.org/heroicgameslauncher",
  lutris: "https://cdn.simpleicons.org/lutris",
  bottles: "https://raw.githubusercontent.com/bottlesdevs/Bottles/main/data/icons/hicolor/scalable/apps/com.usebottles.bottles.svg",
  itch: "https://cdn.simpleicons.org/itchdotio",
};

export function FirstLaunchSetup({
  igdbClientId, setIgdbClientId, igdbClientSecret, setIgdbClientSecret,
  onSignIn, signedIn, credentialStatus, credentialStatusLoaded,
  themes, theme, setTheme, nexusApiKey, setNexusApiKey, saveCredential, credentialBusy, onFinish,
}: SetupProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [sources, setSources] = useState<DetectedImportSource[]>([]);
  const [selectedSources, setSelectedSources] = useState<ImportSourceId[]>([]);
  const [expandedSources, setExpandedSources] = useState<Set<ImportSourceId>>(new Set());
  const [gamesBySource, setGamesBySource] = useState<Record<string, ImportedGame[]>>({});
  const [scanning, setScanning] = useState(false);
  const [entering, setEntering] = useState(false);

  const detected = useMemo(() => sources.filter((source) => source.detected), [sources]);
  const hasChange =
    step === "welcome" ? false :
    step === "account" ? signedIn :
    step === "igdb" ? Boolean(credentialStatus.igdb || credentialStatus.nexus || igdbClientId.trim() || igdbClientSecret.trim() || nexusApiKey.trim()) :
    selectedSources.length > 0;

  useEffect(() => {
    if (step !== "imports") return;
    setScanning(true);
    void detectImportSources()
      .then((result) => {
        setSources(result);
        setSelectedSources(result.filter((source) => source.detected).map((source) => source.id));
      })
      .catch(() => setSources([]))
      .finally(() => setScanning(false));
  }, [step]);

  const goNext = () => {
    if (step === "account" && !signedIn) {
      setStep("imports");
      return;
    }
    const index = steps.indexOf(step);
    if (index < steps.length - 1) {
      setEntering(true);
      window.setTimeout(() => { setStep(steps[index + 1]); setEntering(false); }, 140);
      return;
    }
    const games = selectedSources.flatMap((source) => gamesBySource[source] ?? []);
    onFinish(games, selectedSources);
  };

  const skip = () => {
    if (step === "account" && !signedIn) {
      setStep("imports");
      return;
    }
    const index = steps.indexOf(step);
    if (index < steps.length - 1) {
      setEntering(true);
      window.setTimeout(() => { setStep(steps[index + 1]); setEntering(false); }, 140);
    } else onFinish([], []);
  };

  const previous = () => {
    const index = steps.indexOf(step);
    if (index > 0) setStep(steps[index - 1]);
  };

  const toggleSource = (id: ImportSourceId) => {
    setSelectedSources((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const expandSource = async (source: DetectedImportSource) => {
    const isExpanded = expandedSources.has(source.id);
    setExpandedSources((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(source.id); else next.add(source.id);
      return next;
    });
    if (isExpanded || gamesBySource[source.id]) return;
    setScanning(true);
    try {
      const games = await scanImportGames(source.id);
      setGamesBySource((current) => ({ ...current, [source.id]: games }));
    } catch {
      setGamesBySource((current) => ({ ...current, [source.id]: [] }));
    } finally {
      setScanning(false);
    }
  };

  const buttonText = step === "welcome"
    ? "Get started"
    : hasChange
      ? step === "imports" ? "Import selected" : "Next"
      : "Skip";

  return (
    <div className="setup-shell">
      <div className="setup-orbit setup-orbit-one" />
      <div className="setup-orbit setup-orbit-two" />
      <div className={"setup-panel " + (entering ? "setup-entering" : "")}>
        <div className="setup-progress" aria-label="Setup progress">
          {steps.map((item, index) => <span key={item} className={steps.indexOf(step) >= index ? "active" : ""} />)}
        </div>

        {step === "welcome" && (
          <section className="setup-welcome setup-page">
            <div className="setup-logo"><img src="/mochi.png" alt="Mochi" /></div>
            <p className="setup-welcome-line">Welcome</p>
            <p className="setup-to">to</p>
            <h1 className="mochi-wordmark">Mochi</h1>
            <p className="setup-subtitle">Your games, your way.</p>
            <div className="setup-platform-strip" aria-label="Supported game platforms">
              {(["steam", "heroic", "lutris", "bottles", "itch", "flatpak"] as ImportSourceId[]).map((id) => (
                <div className="setup-platform-logo" key={id} title={sources.find((source) => source.id === id)?.name ?? id}>
                  <img src={platformImages[id]} alt="" />
                </div>
              ))}
            </div>
            <div className="setup-pulse" />
          </section>
        )}

        {step === "theme" && (
          <section className="setup-page setup-theme-page">
            <div className="setup-icon"><Sparkles size={22} /></div>
            <p className="eyebrow">Step 1 of 4</p>
            <h1>Choose your Mochi theme.</h1>
            <p className="setup-description">Mochi has a dark and light edition. We selected a starting point from your system's light/dark preference, and you can change it any time in Settings.</p>
            <div className="setup-theme-grid">
              {themes.filter((option) => option.id === "mochi" || option.id === "mochi-light").map((option) => (
                <button type="button" key={option.id} className={"setup-theme-card " + (theme === option.id ? "selected" : "")} onClick={() => void setTheme(option.id)}>
                  <span className={"setup-theme-preview " + option.id}>
                    <span className="setup-preview-sidebar" />
                    <span className="setup-preview-content"><i /><b /><em /></span>
                  </span>
                  <span className="setup-theme-copy"><strong>{option.name}</strong><small>{option.description}</small></span>
                  {theme === option.id && <span className="setup-theme-check"><Check size={13} /></span>}
                </button>
              ))}
            </div>
            <p className="setup-footnote">System detection uses the standard <code>prefers-color-scheme</code> preference exposed to the app by the desktop webview.</p>
          </section>
        )}

        {step === "account" && (
          <section className="setup-page">
            <div className="setup-icon"><UserRound size={22} /></div>
            <p className="eyebrow">Step 2 of 4</p>
            <h1>Connect your Mochi account.</h1>
            <p className="setup-description">Signing in gives you access to securely stored provider credentials and optional cloud metadata. Your installed games and files remain on this device.</p>
            <div className="setup-choice">
              <div className="setup-choice-icon"><KeyRound size={18} /></div>
              <div><strong>{signedIn ? "Mochi account connected" : "Sign in to Mochi"}</strong><span>{signedIn ? "Your account is connected and ready for account-backed features." : "Access securely stored API credentials and cloud metadata when available."}</span></div>
              {!signedIn && <button className="secondary-button" onClick={onSignIn}><LogIn size={15} /> Sign in</button>}
              {signedIn && <span className="setup-connected"><Check size={14} /> Connected</span>}
            </div>
            <p className="setup-footnote">You can continue without an account. Mochi remains fully usable locally.</p>
          </section>
        )}

        {step === "igdb" && (
          <section className="setup-page setup-form-page">
            <div className="setup-icon"><Sparkles size={22} /></div>
            <p className="eyebrow">Step 3 of 4</p>
            <h1>Connect your game services.</h1>
            <p className="setup-description">Configure the services Mochi can use for game metadata and mod management. Your account must be signed in to securely store these credentials.</p>
            {!signedIn ? (
              <div className="setup-no-sources"><KeyRound size={20} /><strong>API setup skipped.</strong><span>Sign in later from Settings to configure IGDB or Nexus Mods.</span></div>
            ) : !credentialStatusLoaded ? (
              <div className="setup-scan-state"><LoaderCircle size={20} className="spin" /><span>Checking your saved provider credentials…</span></div>
            ) : (
              <div className="setup-provider-fields">
                <div className={"setup-provider-card " + (credentialStatus.igdb ? "configured" : "")}>
                  <div><strong>IGDB</strong><span>{credentialStatus.igdb ? "Already configured on your Mochi account. Credentials cannot be read back." : "Twitch application credentials for game artwork and metadata."}</span></div>
                  {credentialStatus.igdb ? (
                    <div className="setup-provider-configured"><Check size={16} /><strong>Configured</strong><small>Saved securely to your account</small></div>
                  ) : (
                    <>
                      <label>Client ID<input value={igdbClientId} onChange={(event) => setIgdbClientId(event.target.value)} placeholder="Twitch application Client ID" /></label>
                      <label>Client Secret<input type="password" value={igdbClientSecret} onChange={(event) => setIgdbClientSecret(event.target.value)} placeholder="Twitch application Client Secret" /></label>
                    </>
                  )}
                  {!credentialStatus.igdb && <button type="button" className="secondary-button" disabled={credentialBusy === "igdb" || !igdbClientId.trim() || !igdbClientSecret.trim()} onClick={() => void saveCredential("igdb")}>{credentialBusy === "igdb" ? "Saving…" : "Save IGDB credentials"}</button>}
                  {credentialStatus.igdb && <button type="button" className="secondary-button" disabled={credentialBusy === "igdb" || !settings.clientId.trim() || !settings.clientSecret.trim()} onClick={() => void saveCredential("igdb")}>{credentialBusy === "igdb" ? "Saving…" : "Replace IGDB credentials"}</button>}
                </div>
                <div className={"setup-provider-card " + (credentialStatus.nexus ? "configured" : "")}>
                  <div><strong>Nexus Mods</strong><span>{credentialStatus.nexus ? "Already configured on your Mochi account. The saved key cannot be read back." : "Credential for Nexus Mods content integration."}</span></div>
                  {credentialStatus.nexus ? (
                    <div className="setup-provider-configured"><Check size={16} /><strong>Configured</strong><small>Saved securely to your account</small></div>
                  ) : (
                    <label>API key<input type="password" value={nexusApiKey} onChange={(event) => setNexusApiKey(event.target.value)} placeholder="Nexus Mods API key" /></label>
                  )}
                  {!credentialStatus.nexus && <button type="button" className="secondary-button" disabled={credentialBusy === "nexus" || !nexusApiKey.trim()} onClick={() => void saveCredential("nexus")}>Save Nexus key</button>}
                  {credentialStatus.nexus && <button type="button" className="secondary-button" disabled={credentialBusy === "nexus" || !nexusApiKey.trim()} onClick={() => void saveCredential("nexus")}>Replace Nexus key</button>}
                </div>
              </div>
            )}
            <p className="setup-footnote">IGDB uses your Twitch Client ID and Client Secret; Mochi obtains temporary bearer tokens automatically. You never need to enter a bearer token.</p>
          </section>
        )}

        {step === "imports" && (
          <section className="setup-page setup-import-page">
            <div className="setup-icon"><Library size={22} /></div>
            <p className="eyebrow">Step 4 of 4</p>
            <h1>Find your games.</h1>
            <p className="setup-description">Expand a platform to see exactly which games Mochi found. The list is scrollable so large libraries are easy to review.</p>
            {scanning && !detected.length ? (
              <div className="setup-scan-state"><LoaderCircle size={20} className="spin" /><span>Looking for installed game services...</span></div>
            ) : detected.length ? (
              <div className="setup-source-list setup-source-list-scroll">
                {detected.map((source) => {
                  const expanded = expandedSources.has(source.id);
                  const games = gamesBySource[source.id] ?? [];
                  return (
                    <div className={"setup-source-group " + (selectedSources.includes(source.id) ? "selected" : "")} key={source.id}>
                      <div className="setup-source setup-source-header">
                        <button type="button" className="setup-source-main" onClick={() => void expandSource(source)}>
                          <span className="setup-source-check" onClick={(event) => { event.stopPropagation(); toggleSource(source.id); }}>{selectedSources.includes(source.id) ? <Check size={13} /> : null}</span>
                          <span className="setup-source-logo"><img src={platformImages[source.id]} alt="" /></span>
                          <span className="setup-source-copy"><strong>{source.name}</strong><small>{source.gameCount ?? 0} games detected</small></span>
                          <ChevronDown size={17} className={expanded ? "setup-chevron-expanded" : ""} />
                        </button>
                        <button type="button" className="setup-source-toggle" onClick={() => toggleSource(source.id)} aria-label={(selectedSources.includes(source.id) ? "Remove " : "Add ") + source.name}>
                          {selectedSources.includes(source.id) ? <Check size={14} /> : "+"}
                        </button>
                      </div>
                      {expanded && (
                        <div className="setup-source-games">
                          {games.length ? games.map((game) => (
                            <div className="setup-found-game" key={game.id}>
                              <span className="setup-found-game-icon"><Gamepad2 size={15} /></span>
                              <span><strong>{game.name}</strong><small>{game.installPath || "Detected game"}</small></span>
                            </div>
                          )) : <div className="setup-source-empty">{scanning ? "Loading games…" : "No importable games were found for this platform."}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="setup-no-sources"><Gamepad2 size={20} /><strong>No supported game services detected.</strong><span>You can add games manually or configure a source later.</span><button type="button" className="text-button" onClick={() => { setScanning(true); void detectImportSources().then(setSources).finally(() => setScanning(false)); }}><RefreshCw size={14} /> Scan again</button></div>
            )}
          </section>
        )}

        <div className="setup-footer">
          <button className="setup-nav setup-prev" onClick={previous} disabled={step === "welcome"}><ArrowLeft size={16} /> Previous</button>
          <button className="setup-nav setup-next" onClick={hasChange ? goNext : skip} disabled={scanning || credentialBusy !== null}>
            {buttonText} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
