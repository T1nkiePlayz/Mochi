import { A11yChoice, A11yPreview, A11ySlider } from "./settings/AccessibilitySection";
import { ToggleRow } from "./settings/Section";
import { useAccessibility } from "../state/accessibility";

/** Compact accessibility choices for the first-run setup. Shares state with Settings > Accessibility. */
export function AccessibilityQuickSetup() {
  const { settings: s, update } = useAccessibility();
  return <div className="a11y-quick">
    <A11ySlider title="Text size" description="Make everything larger or smaller." value={s.textScale} min={85} max={150} step={5} format={(v) => `${v}%`} onChange={(textScale) => update({ textScale })} />
    <A11yChoice title="Reduce motion" description="Stop animations and sliding transitions." value={s.reduceMotion} options={[{ value: "system", label: "Follow system" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} onChange={(reduceMotion) => update({ reduceMotion })} />
    <A11yChoice title="High contrast" description="Strong borders and black-and-white colours." value={s.highContrast} options={[{ value: "system", label: "Follow system" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} onChange={(highContrast) => update({ highContrast })} />
    <A11yChoice title="Colour-blind mode" description="Distinct status colours." value={s.colorBlind} options={[{ value: "none", label: "Off" }, { value: "deuteranopia", label: "Deuteranopia" }, { value: "protanopia", label: "Protanopia" }, { value: "tritanopia", label: "Tritanopia" }]} onChange={(colorBlind) => update({ colorBlind })} />
    <A11yChoice title="Focus rings" description="How strongly the selected control is outlined." value={s.focusSize} options={[{ value: "normal", label: "Normal" }, { value: "thick", label: "Thick" }, { value: "extra", label: "Extra thick" }]} onChange={(focusSize) => update({ focusSize })} />
    <ToggleRow title="Readable font" description="Atkinson Hyperlegible, easier to tell letters apart." checked={s.dyslexiaFont} onChange={(dyslexiaFont) => update({ dyslexiaFont })} />
    <ToggleRow title="Larger click targets" description="Buttons and fields are at least 44 pixels." checked={s.largeTargets} onChange={(largeTargets) => update({ largeTargets })} />
    <A11yPreview />
    <p className="modal-description">You can change all of this later in Settings, Accessibility.</p>
  </div>;
}
