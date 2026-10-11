import { useEffect, useState } from "react";
import { Select } from "../ui/Select";
import { subscribeActions, useControllerState } from "../../controller/manager";
import { Prompt } from "../../controller/glyphs";
import { useControllerSettings } from "../../controller/settings";
import type { PromptStyle, RepeatSpeed } from "../../controller/types";
import { effectiveStartup, enterBigPicture, isSteamDeckSession, markStartupChoice } from "../../bigpicture/mode";
import { useApp } from "../../state/AppContext";
import { useTranslation } from "../../lib/useTranslation";
import { SettingsGroup, ToggleRow } from "./Section";

const FAMILY_NAMES: Record<string, string> = { xbox: "Xbox", playstation: "PlayStation", switch: "Nintendo Switch", steam: "Steam Controller", deck: "Steam Deck", generic: "Generic" };

const PROMPT_STYLES: Array<{ value: PromptStyle; label: string; description?: string }> = [
  { value: "auto", label: "Match my controller", description: "Show the buttons of the controller you are using." },
  { value: "xbox", label: "Xbox" },
  { value: "playstation", label: "PlayStation" },
  { value: "switch", label: "Nintendo Switch" },
  { value: "deck", label: "Steam Deck" },
  { value: "keyboard", label: "Keyboard" },
];

const SPEEDS: Array<{ value: RepeatSpeed; label: string }> = [{ value: "slow", label: t("Slow") }, { value: "normal", label: t("Normal") }, { value: "fast", label: t("Fast") }];

export function ControllerSection() {
  const t = useTranslation();
  const [settings, update] = useControllerSettings();
  const { pads } = useControllerState();
  const [last, setLast] = useState("");
  // A live readout makes dead-zone and layout choices easy to check.
  useEffect(() => subscribeActions((event) => { if (event.source === "controller" && !event.repeat) setLast(event.action); return false; }, 1000), []);
  const enabled = settings.enabled === true;
  return <SettingsGroup title={t("Controller")} subtitle={t("Xbox, PlayStation, Switch Pro, Steam Deck and Steam Controller")} id="settings-controller">
    <ToggleRow title="Controller navigation" description="Move around Mochi with a controller. Turns on automatically the first time you use one." checked={enabled} onChange={(value) => update({ enabled: value })} />
    <ToggleRow title="Swap confirm and back" description="Use the other face button to confirm. Nintendo layouts are detected automatically." checked={settings.swapConfirmBack} onChange={(swapConfirmBack) => update({ swapConfirmBack })} />
    <label className="setting-row">
      <span><strong>Stick dead zone</strong><small>How far a stick must move before it counts. Raise it if the cursor drifts. Now {Math.round(settings.deadZone * 100)}%.</small></span>
      <input type="range" min={10} max={80} step={5} value={Math.round(settings.deadZone * 100)} aria-label="Stick dead zone" onChange={(event) => update({ deadZone: Number(event.target.value) / 100 })} />
    </label>
    <div className="setting-row"><span><strong>Repeat speed</strong><small>How quickly movement repeats while you hold a direction.</small></span>
      <Select<RepeatSpeed> label="Repeat speed" value={settings.repeatSpeed} options={SPEEDS.map((option) => ({ ...option, label: t(option.label) }))} onChange={(repeatSpeed) => update({ repeatSpeed })} align="end" /></div>
    <div className="setting-row"><span><strong>{t("Button prompts")}</strong><small>Which button icons Mochi shows.</small></span>
      <Select<PromptStyle> label="Button prompts" value={settings.promptStyle} options={PROMPT_STYLES.map((option) => ({ ...option, label: t(option.label), description: option.description ? t(option.description) : undefined }))} onChange={(promptStyle) => update({ promptStyle })} align="end" /></div>
    <ToggleRow title={t("On-screen keyboard")} description={t("Open a built-in keyboard when you confirm a text field with a controller.")} checked={settings.onScreenKeyboard} onChange={(onScreenKeyboard) => update({ onScreenKeyboard })} />
    <div className="setting-row controller-list-row"><span><strong>Connected controllers</strong>
      <small>{pads.length ? t("Press any button to test; the last action appears on the right.") : t("No controller detected. Connect one by cable or Bluetooth.")}</small>
      {pads.length > 0 && <ul className="controller-list">{pads.map((pad) => <li key={pad.key}><span>{pad.name}</span><small>{pad.family === "generic" ? t("Generic") : FAMILY_NAMES[pad.family]}</small></li>)}</ul>}
    </span>
      <span className="metadata-note controller-readout" aria-live="polite">{last ? <><Prompt action={last as never} /> {last}</> : t("Waiting for input")}</span></div>
  </SettingsGroup>;
}

export function BigPictureSection() {
  const t = useTranslation();
  const { behavior, setBehavior } = useApp();
  const deck = isSteamDeckSession();
  return <SettingsGroup title={t("Big Picture & Steam Deck")} subtitle={t("A full-screen, controller-first view of your library")} id="settings-bigpicture">
    <div className="setting-row"><span><strong>Open Big Picture</strong><small>Switch now. You can also press F11, or hold Start and Select on a controller.</small></span>
      <button type="button" className="secondary-button" onClick={enterBigPicture}>Open</button></div>
    <ToggleRow title={t("Start in Big Picture")} description={`${t("Open full screen in Big Picture when Mochi starts, including when it starts at login.")}${deck ? ` ${t("On by default in Steam Gaming Mode.")}` : ""}`}
      checked={effectiveStartup(behavior.bigPictureOnStartup)} onChange={(bigPictureOnStartup) => { markStartupChoice(); setBehavior((current) => ({ ...current, bigPictureOnStartup })); }} />
    {deck && <div className="setting-row"><span><strong>Steam Deck</strong><small>Detected. Touch targets are larger and the on-screen keyboard is on.</small></span><span className="metadata-note">Detected</span></div>}
  </SettingsGroup>;
}
