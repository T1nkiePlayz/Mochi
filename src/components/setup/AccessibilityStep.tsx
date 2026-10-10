import { Accessibility } from "lucide-react";
import { AccessibilityQuickSetup } from "../AccessibilityQuickSetup";
import { useTranslation } from "../../lib/useTranslation";
import { useTranslation } from "../../lib/useTranslation";

export function AccessibilityStep() {
  const t = useTranslation();
  return (
    <section className="setup-page">
      <div className="setup-icon"><Accessibility size={22} /></div>
      <h1>{t("Make Mochi comfortable.")}</h1>
      <p className="setup-description">{t("Pick text size, motion and contrast now. These are saved on this device and you can change them any time in Settings.")}</p>
      <div className="setup-scroll"><AccessibilityQuickSetup /></div>
    </section>
  );
}
