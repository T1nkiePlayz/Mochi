import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "../lib/useTranslation";
import { confirmAction } from "../lib/confirm";
import { selfInstallApply, selfInstallSkip, selfInstallStatus, selfInstallVerify, type SelfInstallStatus, type VerifyResult } from "../lib/selfInstall";

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; message: string };

export function unverifiedMessage(status: SelfInstallStatus, result: VerifyResult["status"], t: (message: string) => string = (message) => message): string {
  const base = result === "offline"
    ? t("You're offline, so Mochi couldn't check this download against the signed release on GitHub.")
    : result === "unavailable"
      ? t("There's no signed release on GitHub for Mochi {version}, so this download couldn't be checked.").replace("{version}", status.version)
      : t("This file doesn't match the signed release of Mochi {version}. It may be damaged or modified.").replace("{version}", status.version);
  return base + (status.firstInstall ? ` ${t("Install it anyway?")}` : ` ${t("Replace the installed version ({version}) with this one anyway?").replace("{version}", status.installedVersion ?? t("current version"))}`);
}

/** Verifies a freshly opened build before it installs over the managed copy. Mounted once in AppProvider. */
export function SelfInstallPrompt() {
  const t = useTranslation();
  const [status, setStatus] = useState<SelfInstallStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const dialog = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const apply = useCallback(async () => {
    setPhase((current) => current.kind === "busy" ? current : { kind: "busy", text: t("Installing…") });
    try { await selfInstallApply(); } catch (error) { setPhase({ kind: "error", message: String(error) }); }
  }, [t]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let found: SelfInstallStatus | null;
      try { found = await selfInstallStatus(); } catch { return; }
      if (!found) return;
      setStatus(found);
      setPhase({ kind: "busy", text: t("Checking this download against the signed release on GitHub…") });
      let result: VerifyResult;
      try { result = await selfInstallVerify(); } catch { result = { status: "unavailable", detail: "" }; }
      if (result.status === "verified") {
        setPhase({ kind: "busy", text: t("Verified. Mochi will restart from {path}.").replace("{path}", found.targetPath) });
        await apply();
        return;
      }
      setPhase({ kind: "idle" });
      const ok = await confirmAction({
        title: "This version of Mochi couldn't be verified",
        message: unverifiedMessage(found, result.status, t),
        items: [`From: ${found.sourcePath}`, `To: ${found.targetPath}`],
        confirmLabel: found.firstInstall ? "Install anyway" : "Replace anyway",
        danger: true,
      });
      if (ok) await apply();
      else { try { await selfInstallSkip(); } catch { /* nothing more to do */ } setStatus(null); }
    })();
  }, [apply, t]);

  useEffect(() => { if (phase.kind !== "idle") dialog.current?.focus(); }, [phase.kind]);

  if (!status || phase.kind === "idle") return null;
  const close = async () => { try { await selfInstallSkip(); } catch { /* ignore */ } setStatus(null); setPhase({ kind: "idle" }); };
  return <div className="modal-backdrop confirm-backdrop">
    <div ref={dialog} tabIndex={-1} className="modal confirm-dialog self-install-dialog" role="dialog" aria-modal="true" aria-labelledby="self-install-title">
      <h2 id="self-install-title">Installing Mochi {status.version}</h2>
      {phase.kind === "busy"
        ? <p className="modal-description self-install-status" role="status" aria-live="polite"><Loader2 className="self-install-spinner" size={16} aria-hidden="true" /><span>{t(phase.text)}</span></p>
        : <>
          <p className="modal-description" role="alert">{t(phase.message)}</p>
          <div className="confirm-actions">
            <button type="button" className="secondary-button" onClick={close}>{t("Close")}</button>
            <button type="button" className="play-button" onClick={apply}>{t("Try again")}</button>
          </div>
        </>}
    </div>
  </div>;
}
