import { Check, CloudDownload, CloudOff, LoaderCircle, RefreshCw } from "lucide-react";

type Props = {
  busy: boolean;
  message: string;
  syncEnabled: boolean;
  syncState: string;
  onImport: () => Promise<void>;
};

export function CloudImportStep({ busy, message, syncEnabled, syncState, onImport }: Props) {
  const syncing = syncState === "syncing" || syncState === "retrying";
  return <section className="setup-page setup-cloud-page">
    <div className="setup-icon"><CloudDownload size={22} /></div>
    <h1>Bring your cloud library with you.</h1>
    <p className="setup-description">If you have used Mochi on another device, import the games saved to your account. Mochi merges cloud games into this device and keeps games that exist only here.</p>
    <div className="setup-cloud-card">
      <div className="setup-cloud-status">
        {syncEnabled ? <Check size={18} /> : <CloudOff size={18} />}
        <span><strong>{syncEnabled ? "Cloud sync is enabled" : "Cloud sync is not enabled"}</strong><small>{syncing ? "Mochi is checking your cloud account…" : syncEnabled ? "Your account can sync library metadata." : "You can still try importing your saved cloud library. Sync preferences can be managed later."}</small></span>
      </div>
      <button type="button" className="play-button setup-cloud-import" onClick={() => void onImport()} disabled={busy || syncing}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
        {busy ? "Importing cloud library…" : "Check and import cloud data"}
      </button>
      <p className="setup-cloud-safety">This does not delete your local games or move any installed files.</p>
      {message && <p className="setup-cloud-message" role="status">{message}</p>}
    </div>
  </section>;
}
