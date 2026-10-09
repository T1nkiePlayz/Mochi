import { ExternalLink, X } from "lucide-react";
import { openExternalUrl } from "../../lib/platform";
import type { InstallNotice } from "./useModInstall";
import { NxmHandlerToggle } from "./NxmHandlerToggle";

export function InstallNoticeBar({ notice, onDismiss }: { notice: InstallNotice | null; onDismiss: () => void }) {
  if (!notice) return null;
  return <div className={`mod-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
    <span>{notice.message}</span>
    {notice.pageUrl && <button type="button" className="secondary-button" onClick={() => void openExternalUrl(notice.pageUrl!).catch(() => undefined)}><ExternalLink size={13} /> {notice.pageLabel ?? "Open page"}</button>}
    {notice.force && <button type="button" className="secondary-button" onClick={() => { const force = notice.force; onDismiss(); force?.(); }}>Install anyway</button>}
    <button type="button" className="icon-button" aria-label="Dismiss message" onClick={onDismiss}><X size={14} /></button>
    {notice.nexusManager && <div className="mod-notice-extra"><small>On the Nexus page, click "Mod Manager Download": Mochi receives the link and asks which Tofu to download into.</small><NxmHandlerToggle compact /></div>}
  </div>;
}
