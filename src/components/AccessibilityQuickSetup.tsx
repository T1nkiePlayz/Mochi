import { A11yChoice, A11yPreview, A11ySlider } from "./settings/AccessibilitySection";
import { ToggleRow } from "./settings/Section";
import { useAccessibility } from "../state/accessibility";
import { useTranslation } from "../lib/useTranslation";

/** Compact accessibility choices for the first-run setup. Shares state with Settings > Accessibility. */
export function AccessibilityQuickSetup() {
  const { settings: s, update } = useAccessibility();
  const t = useTranslation();
  return <div className="a11y-quick">
    <A11ySlider title={t("Text size")} description={t("Make everything larger or smaller.")} value={s.textScale} min={85} max={150} step={5} format={(v) => `${v}%`} onChange={(textScale) => update({ textScale })} />
    <A11yChoice title={t("Reduce motion")} description={t("Stop animations and sliding transitions.")} value={s.reduceMotion} options={[{ value: "system", label: "Follow system" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} onChange={(reduceMotion) => update({ reduceMotion })} />
    <A11yChoice title={t("High contrast")} description={t("Strong borders and black-and-white colours.")} value={s.highContrast} options={[{ value: "system", label: "Follow system" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} onChange={(highContrast) => update({ highContrast })} />
    <A11yChoice title={t("Colour-blind mode")} description={t("Distinct status colours.")} value={s.colorBlind} options={[{ value: "none", label: "Off" }, { value: "deuteranopia", label: "Deuteranopia" }, { value: "protanopia", label: "Protanopia" }, { value: "tritanopia", label: "Tritanopia" }]} onChange={(colorBlind) => update({ colorBlind })} />
    <A11yChoice title={t("Focus rings")} description={t("How strongly the selected control is outlined.")} value={s.focusSize} options={[{ value: "normal", label: "Normal" }, { value: "thick", label: "Thick" }, { value: "extra", label: "Extra thick" }]} onChange={(focusSize) => update({ focusSize })} />
    <ToggleRow title={t("Readable font")} description={t("Atkinson Hyperlegible, easier to tell letters apart.")} checked={s.dyslexiaFont} onChange={(dyslexiaFont) => update({ dyslexiaFont })} />
    <ToggleRow title={t("Larger click targets")} description={t("Buttons and fields are at least 44 pixels.")} checked={s.largeTargets} onChange={(largeTargets) => update({ largeTargets })} />
    <A11yPreview />
    <p className="modal-description">{t("You can change all of this later in Settings, Accessibility.")}</p>
  </div>;
}
