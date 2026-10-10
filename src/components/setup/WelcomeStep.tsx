import { launcherIcon } from "../../lib/launcherArt";
import { useTranslation } from "../../lib/useTranslation";

const brands = [["steam", "Steam"], ["heroic", "Heroic"], ["lutris", "Lutris"], ["bottles", "Bottles"], ["itch", "itch.io"], ["flatpak", "Flatpak"]] as const;

export function WelcomeStep() {
  const t = useTranslation();
  return (
    <section className="setup-welcome setup-page">
      <div className="setup-logo"><img src="/mochi-mark.png" alt="Mochi" /></div>
      <p className="setup-welcome-line">{t("Welcome")}</p>
      <p className="setup-to">to</p>
      <h1 className="mochi-wordmark">Mochi</h1>
      <p className="setup-subtitle">{t("Your games, your way.")}</p>
      <div className="setup-platform-strip" aria-label="Supported game platforms">
        {brands.map(([id, name]) => <div className="setup-platform-logo" key={id} title={name}><img src={launcherIcon(id)} alt={name} /></div>)}
      </div>
      <div className="setup-pulse" />
    </section>
  );
}
