import { ExternalLink } from "lucide-react";
import { CF_SITE } from "../../lib/curseforge";
import { openExternalUrl } from "../../lib/platform";

/** Attribution the CurseForge API terms ask for. Shown wherever CurseForge content is listed. */
export function CurseforgeCredit() {
  return <p className="curseforge-credit">Powered by <button type="button" className="text-button" onClick={() => void openExternalUrl(CF_SITE).catch(() => undefined)}>CurseForge</button></p>;
}

export function ViewOnSite({ url, label }: { url: string; label: string }) {
  return <button type="button" className="secondary-button" onClick={() => void openExternalUrl(url).catch(() => undefined)}><ExternalLink size={13} /> {label}</button>;
}
