import { useState } from "react";
import { useTranslation } from "../../lib/useTranslation";
import { scannerHealth, type SourceHealth, type SourceHealthStatus } from "../../lib/sources";

/** Settings > Library tools: whether each launcher's files could still be read on the last check. */
export function SourceHealthPanel() {
  const t = useTranslation();
  const [report, setReport] = useState<SourceHealth[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const labels: Record<SourceHealthStatus, string> = {
    ok: t("Working"), not_installed: t("Not installed"), empty: t("Nothing to import"), partial: t("Partly unreadable"), parse_error: t("Unreadable"),
  };
  const run = async () => {
    setBusy(true); setError(false);
    try { setReport(await scannerHealth()); } catch { setError(true); } finally { setBusy(false); }
  };
  const shown = (report ?? []).filter((item) => item.status !== "not_installed");
  return <div id="settings-sourcehealth">
    <div className="setting-row"><span><strong>{t("Source health")}</strong><small>{t("Checks that Mochi can still read each launcher's files. If a launcher changes its file format, it is flagged here instead of silently showing no games.")}</small></span>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void run()}>{busy ? t("Checking…") : t("Run check")}</button></div>
    {error && <p className="metadata-note" role="status">{t("Could not run the source check.")}</p>}
    {shown.length > 0 && <ul className="source-health-list" aria-label={t("Source health")}>{shown.map((item) => <li key={item.id}>
      <details>
        <summary><strong>{item.name}</strong> <span className={`status-pill source-health-${item.status}`}>{labels[item.status]}</span></summary>
        <p>{t("{games} games, {files} files checked").replace("{games}", String(item.gameCount)).replace("{files}", String(item.filesExamined))}</p>
        {item.failures.length > 0 && <ul>{item.failures.map((failure) => <li key={failure.path}><code>{failure.path}</code>: {failure.reason}</li>)}</ul>}
      </details>
    </li>)}</ul>}
  </div>;
}
