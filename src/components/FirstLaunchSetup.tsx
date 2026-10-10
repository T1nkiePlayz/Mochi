import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ThemeDescriptor } from "../lib/theme";
import type { ProviderCredential } from "../lib/providerCredentials";
import type { ImportSourceId, ImportedGame } from "../lib/sources";
import type { PickerSelection } from "./import/SourceGamePicker";
import type { MinecraftMode } from "../lib/minecraftCopy";
import { WelcomeStep } from "./setup/WelcomeStep";
import { LanguageStep } from "./setup/LanguageStep";
import type { LauncherLanguage } from "../lib/languages";
import { ThemeStep } from "./setup/ThemeStep";
import { AccessibilityStep } from "./setup/AccessibilityStep";
import { AccountStep } from "./setup/AccountStep";
import { ServicesStep } from "./setup/ServicesStep";
import { ImportStep } from "./setup/ImportStep";
import { CloudImportStep } from "./setup/CloudImportStep";

type SetupProps = {
  igdbClientId: string;
  setIgdbClientId: (value: string) => void;
  igdbClientSecret: string;
  setIgdbClientSecret: (value: string) => void;
  onSignIn: () => void;
  user: User | null;
  language: string;
  setLanguage: (language: LauncherLanguage) => void;
  onAddUser?: () => void;
  credentialStatus: Record<ProviderCredential, boolean>;
  credentialStatusLoaded: boolean;
  themes: ThemeDescriptor[];
  theme: string;
  setTheme: (themeId: string) => Promise<void>;
  nexusApiKey: string;
  setNexusApiKey: (value: string) => void;
  steamGridDbKey: string;
  setSteamGridDbKey: (value: string) => void;
  saveCredential: (provider: ProviderCredential) => Promise<void>;
  credentialBusy: ProviderCredential | null;
  onFinish: (games: ImportedGame[], sources: ImportSourceId[], minecraftMode: MinecraftMode) => void;
  cloudSyncEnabled: boolean;
  cloudSyncState: string;
  cloudImportBusy: boolean;
  cloudImportMessage: string;
  onImportCloudData: () => Promise<void>;
};

const steps = ["welcome", "language", "theme", "accessibility", "account", "cloud", "services", "imports"] as const;
type Step = typeof steps[number];
const stepLabels: Record<Step, string> = { welcome: "Welcome", language: "Language", theme: "Theme", accessibility: "Accessibility", account: "Account", cloud: "Cloud library", services: "Game services", imports: "Find your games" };

export function FirstLaunchSetup(props: SetupProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [selection, setSelection] = useState<PickerSelection>({ games: [], sources: [], minecraftMode: "copy" });
  const index = steps.indexOf(step);
  const last = index === steps.length - 1;

  // The services step is only useful when signed in, so signed-out users skip straight past it.
  const hop = (direction: 1 | -1) => {
    let next = index + direction;
    while (steps[next] && !props.user && (steps[next] === "cloud" || steps[next] === "services")) next += direction;
    if (next >= 0 && next < steps.length) setStep(steps[next]);
  };

  const finish = () => props.onFinish(selection.games, selection.sources, selection.minecraftMode);
  const nextLabel = step === "welcome" ? "Get started" : last ? (selection.games.length ? `Import ${selection.games.length} and finish` : "Finish") : "Next";

  return (
    <div className="setup-shell">
      <div className="setup-orbit setup-orbit-one" />
      <div className="setup-orbit setup-orbit-two" />
      <div className="setup-panel setup-panel-wide" role="dialog" aria-label="Welcome to Mochi setup">
        <div className="setup-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-valuetext={`Step ${index + 1} of ${steps.length}: ${stepLabels[step]}`}>
          {steps.map((item, position) => <span key={item} className={position <= index ? "active" : ""} />)}
        </div>
        <div className="setup-body" key={step}>
          {step === "welcome" && <WelcomeStep />}
          {step === "language" && <LanguageStep language={props.language} setLanguage={props.setLanguage} />}
          {step === "theme" && <ThemeStep themes={props.themes} theme={props.theme} setTheme={props.setTheme} />}
          {step === "accessibility" && <AccessibilityStep />}
          {step === "account" && <AccountStep user={props.user} onSignIn={props.onSignIn} onAddUser={props.onAddUser} />}
          {step === "cloud" && <CloudImportStep busy={props.cloudImportBusy} message={props.cloudImportMessage} syncEnabled={props.cloudSyncEnabled} syncState={props.cloudSyncState} onImport={props.onImportCloudData} />}
          {step === "services" && <ServicesStep {...props} signedIn={Boolean(props.user)} />}
          {step === "imports" && <ImportStep onSelectionChange={setSelection} />}
        </div>
        <div className="setup-footer">
          <button type="button" className="setup-nav setup-prev" onClick={() => hop(-1)} disabled={step === "welcome"}><ArrowLeft size={16} /> Back</button>
          <span className="setup-step-label">{stepLabels[step]} · {index + 1}/{steps.length}</span>
          <div className="setup-footer-actions">
            {step !== "welcome" && step !== "account" && !last && <button type="button" className="setup-skip text-button" onClick={() => hop(1)} disabled={props.credentialBusy !== null}>Skip</button>}
            <button type="button" className="setup-nav setup-next" onClick={last ? finish : () => hop(1)} disabled={props.credentialBusy !== null}>{nextLabel} <ArrowRight size={16} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
