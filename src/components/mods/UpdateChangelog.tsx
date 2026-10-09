import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { openExternalUrl } from "../../lib/platform";
import { loadChangelog, type Changelog } from "../../lib/mods/updateChangelog";
import type { ModUpdateItem } from "../../lib/mods/updates";
import { Markdown } from "../discover/Markdown";

/** The changelog body: fetched (memoised, 3 at a time) only once `active`, i.e. when the row is expanded or the sheet is open. */
export function ChangelogBody({ item, active }: { item: ModUpdateItem; active: boolean }) {
  const [log, setLog] = useState<Changelog | "loading" | "error">("loading");
  useEffect(() => {
    if (!active) return;
    let live = true;
    setLog("loading");
    loadChangelog(item).then((value) => { if (live) setLog(value); }, () => { if (live) setLog("error"); });
    return () => { live = false; };
  }, [active, item]);
  if (log === "loading") return <p className="muted" role="status">Loading changelog...</p>;
  if (log === "error") return <p className="muted" role="status">Could not load the changelog.</p>;
  if (log.kind === "markdown") return <div className="update-changelog-text"><Markdown source={log.text} /></div>;
  if (log.kind === "link") return <button type="button" className="secondary-button dep-link" onClick={() => void openExternalUrl(log.url).catch(() => undefined)}><ExternalLink size={13} /> {log.label}</button>;
  return <p className="muted">No changelog was published.</p>;
}

/** A disclosure button plus its body. Collapsed by default, so nothing is fetched until the user asks. */
export function ChangelogToggle({ item }: { item: ModUpdateItem }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  return <div className="update-changelog">
    <button type="button" className="update-changelog-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon size={13} aria-hidden="true" /> Changelog</button>
    {open && <div className="update-changelog-body"><ChangelogBody item={item} active /></div>}
  </div>;
}
