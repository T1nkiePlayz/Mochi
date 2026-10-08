import { Accessibility } from "lucide-react";
import { AccessibilityQuickSetup } from "../AccessibilityQuickSetup";

export function AccessibilityStep() {
  return (
    <section className="setup-page">
      <div className="setup-icon"><Accessibility size={22} /></div>
      <h1>Make Mochi comfortable.</h1>
      <p className="setup-description">Pick text size, motion and contrast now. These are saved on this device and you can change them any time in Settings.</p>
      <div className="setup-scroll"><AccessibilityQuickSetup /></div>
    </section>
  );
}
