import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { confirmAction } from "../lib/confirm";
import { selfInstallApply, selfInstallSkip, selfInstallStatus, selfInstallVerify, type SelfInstallStatus, type VerifyResult } from "../lib/selfInstall";

type Phase = { kind: "idle" } | { kind: "busy"; text: string } | { kind: "error"; message: string };

export function unverifiedMessage(status: SelfInstallStatus, result: VerifyResult["status"]): string {
  const base = result === "offline"
    ? "You're offline, so Mochi couldn't check this download against the signed release on GitHub."
    : result === "unavailable"
      ? `There's no signed release on GitHub for Mochi ${status.version}, so this download couldn't be checked.`
      : `This file doesn't match the signed release of Mochi ${status.version}. It may be damaged or modified.`;
  return base + (status.firstInstall ? " Install it anyway?" : ` Replace the installed version (${status.installedVersion ?? "current version"}) with this one anyway?`);
}

/** Verifies a freshly opened build before it installs over the managed copy. Mounted once in AppProvider. */
export function SelfInstallPrompt() {
  const [status, setStatus] = useState<SelfInstallStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const dialog = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const apply = useCallback(async () => {
    setPhase((current) => current.kind === "busy" ? current : { kind: "busy", text: "Installing…" });
    try { await selfInstallApply(); } catch (error) { setPhase({ kind: "error", message: String(error) }); }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let found: SelfInstallStatus | null;
      try { found = await selfInstallStatus(); } catch { return; }
      if (!found) return;
      setStatus(found);
      setPhase({ kind: "busy", text: "Checking this download against the signed release on GitHub…" });
      let result: VerifyResult;
      try { result = await selfInstallVerify(); } catch { result = { status: "unavailable", detail: "" }; }
      if (result.status === "verified") {
        setPhase({ kind: "busy", text: `Verified. Mochi will restart from ${found.targetPath}.` });
        await apply();
        return;
      }
      setPhase({ kind: "idle" });
      const ok = await confirmAction({
        title: "This version of Mochi couldn't be verified",
        message: unverifiedMessage(found, result.status),
        items: [`From: ${found.sourcePath}`, `To: ${found.targetPath}`],
        confirmLabel: found.firstInstall ? "Install anyway" : "Replace anyway",
        danger: true,
      });
      if (ok) await apply();
      else { try { await selfInstallSkip(); } catch { /* nothing more to do */ } setStatus(null); }
    })();
  }, [apply]);

  useEffect(() => { if (phase.kind !== "idle") dialog.current?.focus(); }, [phase.kind]);

  if (!status || phase.kind === "idle") return null;
  const close = async () => { try { await selfInstallSkip(); } catch { /* ignore */ } setStatus(null); setPhase({ kind: "idle" }); };
  return <div className="modal-backdrop confirm-backdrop">
    <div ref={dialog} tabIndex={-1} className="modal confirm-dialog self-install-dialog" role="dialog" aria-modal="true" aria-labelledby="self-install-title">
      <h2 id="self-install-title">Installing Mochi {status.version}</h2>
      {phase.kind === "busy"
        ? <p className="modal-description self-install-status" role="status" aria-live="polite"><Loader2 className="self-install-spinner" size={16} aria-hidden="true" /><span>{phase.text}</span></p>
        : <>
          <p className="modal-description" role="alert">{phase.message}</p>
          <div className="confirm-actions">
            <button type="button" className="secondary-button" onClick={close}>Close</button>
            <button type="button" className="play-button" onClick={apply}>Try again</button>
          </div>
        </>}
    </div>
  </div>;
}
