import { Newspaper, ExternalLink as ExternalLinkIcon, Puzzle } from "lucide-react";
import { useGameNews, markNewsRead } from "../state/gameNewsStore";
import { useApp } from "../state/AppContext";
import { DealsPanel } from "../components/DealsPanel";
import { openExternalUrl } from "../lib/platform";
import { useEffect } from "react";

const dateLabel = (seconds: number) => Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toLocaleDateString() : "Recently";

export function DealsView() {
  const { behavior } = useApp();
  const { news, mods } = useGameNews();
  useEffect(() => { if (behavior.gameNews) markNewsRead(); }, [behavior.gameNews]);
  return <div className="deals-view">
    <div className="settings-intro"><h2>Deals</h2><p>Discover giveaways, sales and price watches for your wishlist, alongside updates for games in your library.</p></div>
    <DealsPanel />
    {behavior.gameNews && <section className="deals-panel deals-news-panel" aria-label="Game news">
      <header className="deals-section-head">
        <div className="deals-section-icon"><Newspaper size={19} aria-hidden="true" /></div>
        <div className="deals-section-title"><h3>Game news</h3><p>Recent announcements for games in your library, using your current launcher locale.</p></div>
        <span className="deals-count">{news.items.length + mods.length}</span>
      </header>
      {mods.length > 0 && <section className="deals-results">
        <div className="deals-subhead"><Puzzle size={15} aria-hidden="true" /><div><strong>Mod updates</strong><small>Updates detected for your installed content</small></div><span className="deals-count">{mods.length}</span></div>
        <div className="deals-news-list">{mods.slice(0, 20).map((mod) => <article className="deals-news-item" key={mod.key}>
          <span className="deals-news-mark"><Puzzle size={15} aria-hidden="true" /></span><span className="deals-news-copy"><strong>Mod update: {mod.title}</strong><small>{mod.tofu} · Version {mod.version}</small></span>
        </article>)}</div>
      </section>}
      {news.items.length > 0 && <section className="deals-results">
        <div className="deals-subhead"><Newspaper size={15} aria-hidden="true" /><div><strong>Announcements</strong><small>Latest news posts from your games</small></div></div>
        <div className="deals-news-list">{news.items.slice(0, 40).map((item) => <button type="button" className="deals-news-item" key={item.gid} onClick={() => void openExternalUrl(item.url).catch(() => {})}>
          <span className="deals-news-mark"><Newspaper size={15} aria-hidden="true" /></span><span className="deals-news-copy"><strong>{item.game}: {item.title}</strong><small>{item.summary || item.feedLabel || "Game announcement"} · {dateLabel(item.date)}</small></span><ExternalLinkIcon size={14} aria-hidden="true" />
        </button>)}</div>
      </section>}
      {!mods.length && !news.items.length && <div className="deals-empty-inline">No game news yet. News is checked periodically while Mochi is open and visible.</div>}
    </section>}
  </div>;
}
