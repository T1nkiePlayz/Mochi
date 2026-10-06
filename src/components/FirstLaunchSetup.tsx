import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Gamepad2, KeyRound, Library, LoaderCircle, LogIn, RefreshCw, SkipForward, Sparkles, UserRound } from "lucide-react";
import type { IgdbSettings } from "../lib/igdb";
import { detectImportSources, scanImportGames, type DetectedImportSource, type ImportSourceId, type ImportedGame } from "../lib/sources";

type SetupProps = {
  settings: IgdbSettings;
  setSettings: (settings: IgdbSettings) => void;
  onSignIn: () => void;
  onFinish: (games: ImportedGame[], sources: ImportSourceId[]) => void;
};

const steps = ["welcome", "account", "igdb", "imports"] as const;
type Step = typeof steps[number];

export function FirstLaunchSetup({ settings, setSettings, onSignIn, onFinish }: SetupProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [sources, setSources] = useState<DetectedImportSource[]>([]);
  const [selectedSources, setSelectedSources] = useState<ImportSourceId[]>([]);
  const [scanning, setScanning] = useState(false);
  const [entering, setEntering] = useState(false);

  const detected = useMemo(() => sources.filter((source) => source.detected), [sources]);

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

  const advance = () => {
    const index = steps.indexOf(step);
    if (index < steps.length - 1) {
      setEntering(true);
      window.setTimeout(() => {
        setStep(steps[index + 1]);
        setEntering(false);
      }, 140);
    } else {
      setScanning(true);
      void Promise.all(selectedSources.map((source) => scanImportGames(source)))
        .then((results) => onFinish(results.flat(), selectedSources))
        .catch(() => onFinish([], selectedSources))
        .finally(() => setScanning(false));
    }
  };

  const previous = () => {
    const index = steps.indexOf(step);
    if (index > 0) setStep(steps[index - 1]);
  };

  const skip = () => {
    if (step === "imports") return onFinish([], []);
    if (step === "igdb") return setStep("imports");
    if (step === "account") return setStep("igdb");
    onFinish([], []);
  };

  const toggleSource = (id: ImportSourceId) => {
    setSelectedSources((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  return (
    <div className="setup-shell">
      <div className="setup-orbit setup-orbit-one" />
      <div className="setup-orbit setup-orbit-two" />
      <div className={`setup-panel ${entering ? "setup-entering" : ""}`}>
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
            <div className="setup-pulse" />
          </section>
        )}

        {step === "account" && (
          <section className="setup-page">
            <div className="setup-icon"><UserRound size={22} /></div>
            <p className="eyebrow">Step 1 of 3</p>
            <h1>Make Mochi yours.</h1>
            <p className="setup-description">Sign in to keep your Mochi metadata and preferences available across devices. You can always use Mochi locally.</p>
            <div className="setup-choice">
              <div className="setup-choice-icon"><KeyRound size={18} /></div>
              <div><strong>Sign in to Mochi Cloud</strong><span>Sync your library metadata and account settings.</span></div>
              <button className="secondary-button" onClick={onSignIn}><LogIn size={15} /> Sign in</button>
            </div>
            <p className="setup-footnote">No account is required. Skipping keeps Mochi local-first.</p>
          </section>
        )}

        {step === "igdb" && (
          <section className="setup-page setup-form-page">
            <div className="setup-icon"><Sparkles size={22} /></div>
            <p className="eyebrow">Step 2 of 3</p>
            <h1>Bring your games to life.</h1>
            <p className="setup-description">IGDB can provide artwork, descriptions and genres when Mochi identifies your games. This is optional and can be configured later.</p>
            <div className="setup-fields">
              <label>Client ID<input value={settings.clientId} onChange={(event) => setSettings({ ...settings, clientId: event.target.value })} placeholder="IGDB client ID" /></label>
              <label>Bearer token<input type="password" value={settings.token} onChange={(event) => setSettings({ ...settings, token: event.target.value })} placeholder="Twitch OAuth token" /></label>
              <label>API key <span>(optional)</span><input type="password" value={settings.apiKey || ""} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} placeholder="Alternative API key" /></label>
            </div>
            <p className="setup-footnote">Credentials stay on this device and are used for optional IGDB lookups.</p>
          </section>
        )}

        {step === "imports" && (
          <section className="setup-page setup-import-page">
            <div className="setup-icon"><Library size={22} /></div>
            <p className="eyebrow">Step 3 of 3</p>
            <h1>Find your games.</h1>
            <p className="setup-description">Mochi can look for games from launchers already installed on this computer. Only detected services are shown.</p>
            {scanning ? (
              <div className="setup-scan-state"><LoaderCircle size={20} className="spin" /><span>Looking for installed game services...</span></div>
            ) : detected.length ? (
              <div className="setup-source-list">
                {detected.map((source) => (
                  <button type="button" key={source.id} className={`setup-source ${selectedSources.includes(source.id) ? "selected" : ""}`} onClick={() => toggleSource(source.id)}>
                    <span className="setup-source-check">{selectedSources.includes(source.id) ? <Check size={13} /> : null}</span>
                    <span className="setup-source-logo"><Gamepad2 size={18} /></span>
                    <span className="setup-source-copy"><strong>{source.name}</strong><small>{source.description}</small></span>
                    {source.gameCount !== null && <span className="setup-source-count">{source.gameCount} games</span>}
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="setup-no-sources"><Gamepad2 size={20} /><strong>No supported game services detected.</strong><span>You can add games manually or configure a source later.</span><button type="button" className="text-button" onClick={() => { setScanning(true); void detectImportSources().then(setSources).finally(() => setScanning(false)); }}><RefreshCw size={14} /> Scan again</button></div>
            )}
          </section>
        )}

        <div className="setup-footer">
          <button className="setup-nav setup-prev" onClick={previous} disabled={step === "welcome"}><ArrowLeft size={16} /> Previous</button>
          {step !== "welcome" && <button className="setup-skip" onClick={skip}>{step === "imports" ? "Skip import" : "Skip"} <SkipForward size={13} /></button>}
          <button className="setup-nav setup-next" onClick={advance} disabled={scanning}>
            {step === "welcome" ? "Get started" : step === "imports" ? "Import selected" : "Next"} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
