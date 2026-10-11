import { Download, X } from "lucide-react";
import { useTranslation } from "../lib/useTranslation";
import { useApp } from "../state/AppContext";
import { useUpdateScheduler, useUpdater } from "../state/useUpdater";

/** Mounts the background update checks and shows a dismissible banner when an update is waiting. */
export function UpdateBanner() {
  const t = useTranslation();
  const { behavior, notifications } = useApp();
  useUpdateScheduler(behavior.autoUpdate, notifications.notify);
  const updater = useUpdater();
  const { info } = updater;
  const visible = info && updater.dismissed !== info.version && ["available", "downloading", "restarting"].includes(updater.status);
  if (!info || !visible) return null;

  const busy = updater.status === "downloading" || updater.status === "restarting";
  const percent = updater.progress?.total ? Math.min(100, Math.round((updater.progress.downloaded / updater.progress.total) * 100)) : undefined;
  return <div className="update-banner" role="status" aria-live="polite">
    <Download size={16} aria-hidden="true" />
    <span className="update-banner-text"><strong>{t("Mochi {version} is available.").replace("{version}", info.version)}</strong>{" "}
      {updater.status === "restarting" ? t("Restarting…") : updater.status === "downloading" ? `${t("Downloading")}${percent !== undefined ? ` ${percent}%` : "…"}` : info.installable ? t("Install it now or later from Settings.") : t("Open the release page to download it.")}
    </span>
    {!busy && <button type="button" className="secondary-button" onClick={() => void updater.installNow()}>{info.installable ? t("Install & restart") : t("Open release page")}</button>}
    {!busy && <button type="button" className="icon-button" aria-label={t("Dismiss update notice")} onClick={updater.dismiss}><X size={15} /></button>}
  </div>;
}
