import { useGameNews, markNewsRead } from "../state/gameNewsStore";
import { useApp } from "../state/AppContext";
import { DealsPanel } from "../components/DealsPanel";
import { openExternalUrl } from "../lib/platform";
import { useEffect } from "react";

/** Optional tab (Settings > Deals & news): free games, sales, price watches for the wishlist, and game news. */
export function DealsView() {
  const { behavior } = useApp();
  const { news, mods } = useGameNews();
  useEffect(() => { if (behavior.gameNews) markNewsRead(); }, [behavior.gameNews]);
  return <div className="deals-view">
    <div className="settings-intro"><h2>Deals</h2><p>Free games and sales for the stores you use, and price watches for your wishlist. Only wishlisted games send notifications.</p></div>
    <DealsPanel />
    {behavior.gameNews && <section className="deals-panel" aria-label="Game news">
      <div className="notification-heading"><strong>Game news</strong></div>
      {mods.slice(0, 20).map((mod) => <div className="notification-item" key={mod.key}><strong>Mod update: {mod.title}</strong><span>{mod.tofu} {mod.version}</span></div>)}
      {news.items.slice(0, 40).map((item) => <button type="button" className="notification-item notification-news-item" key={item.gid} onClick={() => void openExternalUrl(item.url).catch(() => {})}><strong>{item.game}: {item.title}</strong><span>{item.summary || item.feedLabel}</span><small>{new Date(item.date * 1000).toLocaleDateString()}{item.feedLabel ? ` · ${item.feedLabel}` : ""}</small></button>)}
      {!mods.length && !news.items.length && <div className="notification-empty">No news yet. Steam games are checked every few hours while Mochi is open.</div>}
    </section>}
  </div>;
}
