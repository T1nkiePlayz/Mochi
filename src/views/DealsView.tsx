import { Newspaper, ExternalLink as ExternalLinkIcon, Puzzle } from "lucide-react";
import { useGameNews, markNewsRead } from "../state/gameNewsStore";
import { useApp } from "../state/AppContext";
import { DealsPanel } from "../components/DealsPanel";
import { openExternalUrl } from "../lib/platform";
import { useEffect } from "react";
import { useTranslation } from "../lib/useTranslation";
import { getTranslationLocale } from "../lib/translationLocale";
import { newsForLocale } from "../lib/gameNews";

const dateLabel = (seconds: number, t: (message: string) => string) => Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toLocaleDateString(getTranslationLocale()) : t("Recently");

export function DealsView() {
  const t = useTranslation();
  const { behavior } = useApp();
  const { news, mods } = useGameNews();
  // Never flash cached announcements from a previous language while the poller resets and refetches.
  const newsItems = newsForLocale(news, behavior.language);
  useEffect(() => { if (behavior.gameNews) markNewsRead(); }, [behavior.gameNews, news.items]);
  return <div className="deals-view">
    <div className="settings-intro"><h2>{t("Deals")}</h2><p>{t("Discover giveaways, sales and price watches for your wishlist, alongside updates for games in your library.")}</p></div>
    <DealsPanel />
    {behavior.gameNews && <section className="deals-panel deals-news-panel" aria-label={t("Game news")}>
      <header className="deals-section-head">
        <div className="deals-section-icon"><Newspaper size={19} aria-hidden="true" /></div>
        <div className="deals-section-title"><h3>{t("Game news")}</h3><p>{t("Recent announcements for games in your library, using your current launcher locale.")}</p></div>
        <span className="deals-count">{(newsItems.length + mods.length).toLocaleString(getTranslationLocale())}</span>
      </header>
      {mods.length > 0 && <section className="deals-results">
        <div className="deals-subhead"><Puzzle size={15} aria-hidden="true" /><div><strong>{t("Mod updates")}</strong><small>{t("Updates detected for your installed content")}</small></div><span className="deals-count">{mods.length.toLocaleString(getTranslationLocale())}</span></div>
        <div className="deals-news-list">{mods.slice(0, 20).map((mod) => <article className="deals-news-item" key={mod.key}>
          <span className="deals-news-mark"><Puzzle size={15} aria-hidden="true" /></span><span className="deals-news-copy"><strong>{t("Mod update")}: {mod.title}</strong><small>{mod.tofu} · {t("Version")} {mod.version}</small></span>
        </article>)}</div>
      </section>}
      {newsItems.length > 0 && <section className="deals-results">
        <div className="deals-subhead"><Newspaper size={15} aria-hidden="true" /><div><strong>{t("Announcements")}</strong><small>{t("Latest news posts from your games")}</small></div></div>
        <div className="deals-news-list">{newsItems.slice(0, 40).map((item) => <button type="button" className="deals-news-item" key={item.gid} onClick={() => void openExternalUrl(item.url).catch(() => {})}>
          <span className="deals-news-mark"><Newspaper size={15} aria-hidden="true" /></span><span className="deals-news-copy"><strong>{item.game}: {item.title}</strong><small>{item.summary || item.feedLabel || t("Game announcement")} · {dateLabel(item.date, t)}</small></span><ExternalLinkIcon size={14} aria-hidden="true" />
        </button>)}</div>
      </section>}
      {!mods.length && !newsItems.length && <div className="deals-empty-inline">{t("No game news yet.")} {t("News is checked periodically while Mochi is open and visible.")}</div>}
    </section>}
  </div>;
}
