import { useEffect, useState } from "react";
import { getNxmHandler, setNxmHandler, type NxmHandler } from "../../lib/mods/nxmHandler";
import { Switch } from "../ui/Checkbox";

/** "Open Nexus Mods download links with Mochi": the opt-in for free Nexus accounts ("Mod Manager Download"). */
export function NxmHandlerToggle({ compact = false }: { compact?: boolean }) {
  const [handler, setHandler] = useState<NxmHandler | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void getNxmHandler().then(setHandler).catch(() => setHandler(null)); }, []);
  if (!handler) return null;
  if (!handler.configurable) return compact ? null : <p className="metadata-note">Mochi is offered for Nexus Mods "Mod Manager Download" links by macOS. If another app opens them, choose Mochi once in the browser's prompt.</p>;
  return <div className="nxm-toggle">
    <Switch checked={handler.registered} onChange={(on) => { setError(""); void setNxmHandler(on).then(setHandler).catch((reason) => setError(String(reason))); }}
      label="Open Nexus Mods download links with Mochi"
      description={compact ? undefined : "Free Nexus accounts download with the \"Mod Manager Download\" button; Mochi then asks which Tofu the file goes into. Turn off if another mod manager should handle these links."} />
    {error && <p className="metadata-note" role="alert">{error}</p>}
  </div>;
}
