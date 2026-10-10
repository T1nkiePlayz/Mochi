import { Library } from "lucide-react";
import { SourceGamePicker, type PickerSelection } from "../import/SourceGamePicker";
import { useTranslation } from "../../lib/useTranslation";

export function ImportStep({ onSelectionChange }: { onSelectionChange: (selection: PickerSelection) => void }) {
  const t = useTranslation();
  return (
    <section className="setup-page setup-import-page">
      <div className="setup-icon"><Library size={22} /></div>
      <h1>{t("Find your games.")}</h1>
      <p className="setup-description">Pick what to bring in. Nothing is moved or changed; Mochi just remembers how to start each game or launcher.</p>
      <SourceGamePicker onSelectionChange={onSelectionChange} />
    </section>
  );
}
