import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { PickerSelection } from "./import/SourceGamePicker";
import { WelcomeStep } from "./setup/WelcomeStep";
import { LanguageStep } from "./setup/LanguageStep";
import type { LauncherLanguage } from "../lib/languages";
import { ThemeStep } from "./setup/ThemeStep";
import { AccessibilityStep } from "./setup/AccessibilityStep";
import { AccountStep } from "./setup/AccountStep";
import { ServicesStep } from "./setup/ServicesStep";
import { ImportStep } from "./setup/ImportStep";
import { CloudImportStep } from "./setup/CloudImportStep";
import { useTranslation } from "../lib/useTranslation";
import { useApp } from "../state/AppContext";

type SetupProps = {
  setLanguage: (language: LauncherLanguage) => void;
  onAddUser?: () => void;
};

const steps = ["welcome", "language", "theme", "accessibility", "account", "cloud", "services", "imports"] as const;
type Step = typeof steps[number];
const stepLabels: Record<Step, string> = { welcome: "Welcome", language: "Language", theme: "Theme", accessibility: "Accessibility", account: "Account", cloud: "Cloud library", services: "Game services", imports: "Find your games" };

export function FirstLaunchSetup(props: SetupProps) {
  const t = useTranslation();
  const { account, behavior, cloud, credentials, finishFirstLaunchSetup, storage, themeEngine } = useApp();
  const [step, setStep] = useState<Step>("welcome");
  const [selection, setSelection] = useState<PickerSelection>({ games: [], sources: [], minecraftMode: "copy" });
  const index = steps.indexOf(step);
  const last = index === steps.length - 1;

  // The services step is only useful when signed in, so signed-out users skip straight past it.
  const hop = (direction: 1 | -1) => {
    let next = index + direction;
    while (steps[next] && !account.user && (steps[next] === "cloud" || steps[next] === "services")) next += direction;
    if (next >= 0 && next < steps.length) setStep(steps[next]);
  };

  const finish = () => finishFirstLaunchSetup(selection.games, selection.sources, selection.minecraftMode);
  const nextLabel = step === "welcome" ? t("Get started") : last ? (selection.games.length ? t("Import {count} and finish").replace("{count}", String(selection.games.length)) : t("Finish")) : t("Next");

  return (
    <div className="setup-shell">
      <div className="setup-orbit setup-orbit-one" />
      <div className="setup-orbit setup-orbit-two" />
      <div className="setup-panel setup-panel-wide" role="dialog" aria-label={t("Welcome to Mochi setup")}>
        <div className="setup-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-valuetext={`Step ${index + 1} of ${steps.length}: ${t(stepLabels[step])}`}>
          {steps.map((item, position) => <span key={item} className={position <= index ? "active" : ""} />)}
        </div>
        <div className="setup-body" key={step}>
          {step === "welcome" && <WelcomeStep />}
          {step === "language" && <LanguageStep language={behavior.language} setLanguage={props.setLanguage} />}
          {step === "theme" && <ThemeStep themes={themeEngine.themes} theme={themeEngine.theme} setTheme={themeEngine.setTheme} />}
          {step === "accessibility" && <AccessibilityStep />}
          {step === "account" && <AccountStep user={account.user} onSignIn={account.openSignIn} onAddUser={props.onAddUser} />}
          {step === "cloud" && <CloudImportStep busy={cloud.cloudDataBusy} ready={storage.ready} settingsReady={cloud.cloudSettingsReady} accessAllowed={cloud.cloudDataAccessAllowed} message={cloud.cloudDataMessage} syncEnabled={cloud.cloudSyncEnabled} syncState={cloud.syncState} onImport={cloud.importCloudLibrary} />}
          {step === "services" && <ServicesStep signedIn={Boolean(account.user)} credentialStatus={credentials.status} credentialStatusLoaded={credentials.loaded} credentialBusy={credentials.busy} saveCredential={credentials.save}
            igdbClientId={credentials.igdbClientId} setIgdbClientId={credentials.setIgdbClientId} igdbClientSecret={credentials.igdbClientSecret} setIgdbClientSecret={credentials.setIgdbClientSecret}
            nexusApiKey={credentials.nexusApiKey} setNexusApiKey={credentials.setNexusApiKey} steamGridDbKey={credentials.steamGridDbKey} setSteamGridDbKey={credentials.setSteamGridDbKey} />}
          {step === "imports" && <ImportStep onSelectionChange={setSelection} />}
        </div>
        <div className="setup-footer">
          <button type="button" className="setup-nav setup-prev" onClick={() => hop(-1)} disabled={step === "welcome"}><ArrowLeft size={16} /> {t("Back")}</button>
          <span className="setup-step-label">{t(stepLabels[step])} · {index + 1}/{steps.length}</span>
          <div className="setup-footer-actions">
            {step !== "welcome" && step !== "account" && !last && <button type="button" className="setup-skip text-button" onClick={() => hop(1)} disabled={credentials.busy !== null}>{t("Skip")}</button>}
            <button type="button" className="setup-nav setup-next" onClick={last ? finish : () => hop(1)} disabled={credentials.busy !== null}>{nextLabel} <ArrowRight size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
