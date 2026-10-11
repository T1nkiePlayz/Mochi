import { Check, CloudDownload, CloudOff, LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "../../lib/useTranslation";

type Props = {
  busy: boolean;
  ready: boolean;
  accessAllowed: boolean;
  settingsReady: boolean;
  message: string;
  syncEnabled: boolean;
  syncState: string;
  onImport: () => Promise<void>;
};

export function CloudImportStep({ busy, ready, accessAllowed, settingsReady, message, syncEnabled, syncState, onImport }: Props) {
  const t = useTranslation();
  const syncing = syncState === "syncing" || syncState === "retrying";
  return <section className="setup-page setup-cloud-page">
    <div className="setup-icon"><CloudDownload size={22} /></div>
    <h1>{t("Bring your cloud library with you.")}</h1>
    <p className="setup-description">{t("If you have used Mochi on another device, import the games saved to your account. Mochi merges cloud games into this device and keeps games that exist only here.")}</p>
    <div className="setup-cloud-card">
      <div className="setup-cloud-status">
        {syncEnabled ? <Check size={18} /> : <CloudOff size={18} />}
        <span><strong>{syncEnabled ? t("Cloud sync is enabled") : t("Cloud sync is not enabled")}</strong><small>{syncing ? t("Mochi is checking your cloud account…") : syncEnabled ? t("Your account can sync library metadata.") : accessAllowed ? t("Your cloud library is available to import.") : settingsReady ? t("Cloud data access is disabled for this account. Enable it in Settings before importing.") : "Mochi is loading this account’s cloud permissions."}</small></span>
      </div>
      <button type="button" className="play-button setup-cloud-import" onClick={() => void onImport()} disabled={busy || !ready || !settingsReady || !accessAllowed}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
        {busy ? "Importing cloud library…" : !ready ? "Preparing your account…" : !settingsReady ? "Checking your cloud account…" : !accessAllowed ? "Enable cloud access in Settings" : t("Check and import cloud data")}
      </button>
      <p className="setup-cloud-safety">This does not delete your local games or move any installed files.</p>
      {message && <p className="setup-cloud-message" role="status">{message}</p>}
    </div>
  </section>;
}
