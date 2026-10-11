import { useId, type ReactNode } from "react";
import { Check, RotateCcw, TriangleAlert, X } from "lucide-react";
import { SettingsGroup, ToggleRow } from "./Section";
import { announce, useAccessibility, type Accessibility } from "../../state/accessibility";
import { openShortcuts } from "../ShortcutsHelp";
import { useTranslation } from "../../lib/useTranslation";

type Option<T extends string> = { value: T; label: string };

export function A11yChoice<T extends string>({ title, description, value, options, onChange }: { title: string; description: string; value: T; options: Array<Option<T>>; onChange: (value: T) => void }) {
  const t = useTranslation();
  const id = useId();
  return <div className="a11y-control" role="group" aria-labelledby={id}>
    <div className="a11y-control-head"><span><strong id={id}>{title}</strong><small>{description}</small></span></div>
    <div className="a11y-segmented">
      {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{t(option.label)}</button>)}
    </div>
  </div>;
}

export function A11ySlider({ title, description, value, min, max, step, format, onChange }: { title: string; description: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void }) {
  const id = useId();
  return <div className="a11y-control">
    <div className="a11y-control-head"><label htmlFor={id}><strong>{title}</strong><small>{description}</small></label><span className="a11y-value" aria-hidden="true">{format(value)}</span></div>
    <input id={id} className="a11y-range" type="range" min={min} max={max} step={step} value={value} aria-valuetext={format(value)} onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}

export function A11yPreview() {
  const t = useTranslation();
  const { settings } = useAccessibility();
  return <div className="a11y-preview" aria-label="Live preview of your accessibility settings" role="group">
    <h4>Preview</h4>
    <p>Mochi keeps your games in one calm place. <a href="https://github.com/T1nkiePlayz/Mochi" onClick={(event) => event.preventDefault()}>This is a link</a>, and this is body text at your chosen size and spacing.</p>
    <div className="a11y-preview-row">
      <button type="button" className="play-button">Play</button>
      <button type="button" className="secondary-button">Details</button>
      <input aria-label="Sample text field" placeholder="Sample field" className="a11y-sample-input" style={{ minWidth: 0 }} />
      <span className="a11y-chip ok"><Check size={13} aria-hidden="true" /> Ready</span>
      <span className="a11y-chip warn"><TriangleAlert size={13} aria-hidden="true" /> Needs update</span>
      <span className="a11y-chip bad"><X size={13} aria-hidden="true" /> Failed</span>
    </div>
    <small style={{ color: "var(--mochi-text-muted)" }}>Status chips always carry an icon and a word, not only a colour.{settings.colorBlind !== "none" ? ` ${t("Palette: {mode}.").replace("{mode}", settings.colorBlind === "none" ? t("Off") : t(settings.colorBlind === "deuteranopia" ? "Deuteranopia" : settings.colorBlind === "protanopia" ? "Protanopia" : "Tritanopia"))}` : ""}</small>
  </div>;
}

const scaleLabel = (v: number) => `${v}%`;
const triOptions: Array<Option<Accessibility["reduceMotion"]>> = [{ value: "system", label: "Follow system" }, { value: "on", label: "On" }, { value: "off", label: "Off" }];

export function AccessibilitySection() {
  const t = useTranslation();
  const { settings: s, update, reset, effective } = useAccessibility();
  const toggle = (key: keyof Accessibility, title: string, description: string): ReactNode =>
    <ToggleRow title={title} description={description} checked={Boolean(s[key])} onChange={(checked) => update({ [key]: checked } as Partial<Accessibility>)} />;
  return <>
    <SettingsGroup title="Accessibility" subtitle="Changes apply instantly and are stored on this device" id="settings-accessibility">
      <A11yPreview />
      <div className="a11y-actions">
        <button type="button" className="secondary-button" onClick={() => { reset(); announce(t("Accessibility settings reset to defaults.")); }}><RotateCcw size={14} aria-hidden="true" /> Reset to defaults</button>
        <button type="button" className="secondary-button" onClick={openShortcuts}>Keyboard shortcuts</button>
      </div>
    </SettingsGroup>

    <SettingsGroup title="Vision" subtitle="Size, contrast and colour" id="settings-accessibility-vision">
      <A11ySlider title="Text and interface size" description="Scales the whole launcher, from 85% to 150%." value={s.textScale} min={85} max={150} step={5} format={scaleLabel} onChange={(textScale) => update({ textScale })} />
      <A11yChoice title="High contrast" description={`${t("Strong borders and black-and-white colours over any theme.")}${effective.highContrast && s.highContrast === "system" ? ` ${t("Your system asks for more contrast, so this is on.")}` : ""}`} value={s.highContrast} options={triOptions} onChange={(highContrast) => update({ highContrast })} />
      <A11yChoice title="Colour-blind friendly colours" description="Swaps success, warning and error colours for a palette that stays distinct. Icons accompany status text in every mode." value={s.colorBlind} options={[{ value: "none", label: "Off" }, { value: "deuteranopia", label: "Deuteranopia" }, { value: "protanopia", label: "Protanopia" }, { value: "tritanopia", label: "Tritanopia" }]} onChange={(colorBlind) => update({ colorBlind })} />
      {toggle("reduceTransparency", "Reduce transparency and blur", "Uses solid panels instead of frosted glass.")}
      {toggle("simpleBackground", "Simple backgrounds", "Turns off decorative gradients and animated backgrounds.")}
      {toggle("largeCursor", "Large mouse pointer", "Draws a bigger pointer inside Mochi.")}
    </SettingsGroup>

    <SettingsGroup title="Motion" subtitle="Animations and movement" id="settings-accessibility-motion">
      <A11yChoice title="Reduce motion" description={`${t("Stops animations, parallax and sliding transitions.")}${effective.reduceMotion && s.reduceMotion === "system" ? ` ${t("Your system asks for reduced motion, so this is on.")}` : ""}`} value={s.reduceMotion} options={triOptions} onChange={(reduceMotion) => update({ reduceMotion })} />
    </SettingsGroup>

    <SettingsGroup title="Keyboard and focus" subtitle="Make it clear where you are" id="settings-accessibility-focus">
      <A11yChoice title="Focus ring thickness" description="The outline drawn around the control you are on." value={s.focusSize} options={[{ value: "normal", label: "Normal" }, { value: "thick", label: "Thick" }, { value: "extra", label: "Extra thick" }]} onChange={(focusSize) => update({ focusSize })} />
      <A11yChoice title="Focus ring colour" description="Match the theme, or pick a colour that stands out." value={s.focusColor} options={[{ value: "theme", label: "Theme" }, { value: "text", label: "Text colour" }, { value: "yellow", label: "Yellow" }, { value: "cyan", label: "Cyan" }, { value: "magenta", label: "Magenta" }, { value: "orange", label: "Orange" }]} onChange={(focusColor) => update({ focusColor })} />
      <A11ySlider title="Focus ring offset" description="Gap between a control and its ring." value={s.focusOffset} min={0} max={6} step={1} format={(v) => `${v}px`} onChange={(focusOffset) => update({ focusOffset })} />
      {toggle("focusAlways", "Always show focus", "Show the ring after mouse clicks as well, not only for the keyboard.")}
      {toggle("focusDouble", "Double ring", "Adds a contrasting inner ring so focus is visible on any background.")}
      {toggle("keepControlsVisible", "Keep controls visible", "Buttons that normally appear on hover, like the Play button on game cards, are always shown.")}
    </SettingsGroup>

    <SettingsGroup title="Reading" subtitle="Fonts and spacing" id="settings-accessibility-reading">
      {toggle("dyslexiaFont", "Readable font", "Uses Atkinson Hyperlegible, designed for low vision and easy letter recognition. Bundled with Mochi, works offline.")}
      <A11yChoice title="Line spacing" description="Space between lines of text." value={s.lineHeight} options={[{ value: "default", label: "Default" }, { value: "relaxed", label: "Relaxed" }, { value: "loose", label: "Loose" }]} onChange={(lineHeight) => update({ lineHeight })} />
      <A11yChoice title="Letter spacing" description="Space between letters." value={s.letterSpacing} options={[{ value: "default", label: "Default" }, { value: "wide", label: "Wide" }, { value: "wider", label: "Wider" }]} onChange={(letterSpacing) => update({ letterSpacing })} />
      <A11yChoice title="Word spacing" description="Space between words." value={s.wordSpacing} options={[{ value: "default", label: "Default" }, { value: "wide", label: "Wide" }, { value: "wider", label: "Wider" }]} onChange={(wordSpacing) => update({ wordSpacing })} />
      {toggle("underlineLinks", "Underline links", "Links are always underlined, not only coloured.")}
    </SettingsGroup>

    <SettingsGroup title="Interaction" subtitle="Targets and labels" id="settings-accessibility-interaction">
      {toggle("largeTargets", "Larger click targets", "Buttons, links and fields are at least 44 by 44 pixels.")}
      {toggle("textLabels", "Show text labels on icon buttons", "Icon-only buttons display their name next to the icon.")}
    </SettingsGroup>

    <SettingsGroup title="Screen reader" subtitle="Spoken feedback" id="settings-accessibility-screen-reader">
      {toggle("announcements", "Announce status changes", "Mochi reads out results such as saved settings and finished actions through a live region.")}
    </SettingsGroup>
  </>;
}
