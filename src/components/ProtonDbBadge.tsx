import { useEffect, useState } from "react";
import { openExternalUrl } from "../lib/platform";
import { getProtonDbSummary, protonAdvice, protonDbUrl, protonTierLabel, type ProtonDbSummary } from "../lib/protondb";

/** Linux only: how well a Steam game runs under Proton, from ProtonDB. Renders nothing when there is no answer. */
export function ProtonDbBadge({ appid }: { appid: number }) {
  const [summary, setSummary] = useState<ProtonDbSummary | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setSummary(null); setOpen(false);
    void getProtonDbSummary(appid).then((result) => { if (live && result.status === "ok") setSummary(result.summary); });
    return () => { live = false; };
  }, [appid]);
  if (!summary) return null;
  const trend = summary.trendingTier && summary.trendingTier !== summary.tier ? ` Recent reports trend ${protonTierLabel(summary.trendingTier)}.` : "";
  return <span className="protondb">
    <button type="button" className={`protondb-badge protondb-${summary.tier}`} aria-expanded={open} title="Compatibility on Linux, from ProtonDB" onClick={() => setOpen((value) => !value)}>
      ProtonDB: {protonTierLabel(summary.tier)}
    </button>
    {open && <span className="protondb-panel" role="note">
      {protonAdvice(summary.tier)}{trend} <small>{summary.total.toLocaleString()} report{summary.total === 1 ? "" : "s"}.</small>{" "}
      <button type="button" className="link-button" onClick={() => void openExternalUrl(protonDbUrl(appid)).catch(() => {})}>Open on ProtonDB</button>
    </span>}
  </span>;
}
