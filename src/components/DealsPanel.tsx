import { RefreshCw, Store, Tag, Heart, ExternalLink as ExternalLinkIcon, Clock3 } from "lucide-react";
import { useApp } from "../state/AppContext";
import { useWishlist } from "../lib/wishlist";
import { dealStores, filterDeals, storeLabel, watchedItems, type StoreId } from "../lib/deals";
import { openExternalUrl } from "../lib/platform";
import { useTranslation } from "../lib/useTranslation";

const money = (value: number) => `$${value.toFixed(2)}`;
const SHOWN = 8;

function ExternalLink({ href, children, label }: { href: string; children: React.ReactNode; label?: string }) {
  return <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label} onClick={(event) => { event.preventDefault(); void openExternalUrl(href).catch(() => undefined); }}>{children}</a>;
}

/** Store deals, free games and wishlist price watches in the same visual language as the rest of Mochi. */
export function DealsPanel() {
  const t = useTranslation();
  const { deals } = useApp();
  const { items } = useWishlist();
  const watched = watchedItems(items);
  const sales = filterDeals(deals.deals, deals.stores).slice(0, SHOWN);
  const free = deals.stores.includes("epic") ? deals.epic : [];
  const checking = deals.status === "checking";
  const status = deals.status === "offline" ? "Offline · showing saved results" : deals.status === "error" ? deals.message || "Deals are unavailable right now." : deals.checkedAt ? `Updated ${new Date(deals.checkedAt).toLocaleString()}` : "Ready when you are";
  return <section className="deals-panel" aria-label={t("Deals")}>
    <header className="deals-section-head">
      <div className="deals-section-icon"><Tag size={19} aria-hidden="true" /></div>
      <div className="deals-section-title"><h3>Free games &amp; deals</h3><p>Find something new to play, without leaving Mochi.</p></div>
      <button type="button" className="secondary-button deals-refresh" onClick={deals.refresh} disabled={checking} aria-label={t("Refresh")}><RefreshCw size={14} className={checking ? "deals-refresh-spin" : ""} aria-hidden="true" /> {checking ? "Checking…" : "Refresh"}</button>
    </header>
    <div className="deals-status" role="status" aria-live="polite"><span className={deals.status === "error" || deals.status === "offline" ? "deals-status-dot muted" : "deals-status-dot"} />{status}</div>
    <section className="deals-preferences" aria-label="Deal sources">
      <div className="deals-subhead"><Store size={15} aria-hidden="true" /><div><strong>{t("Your stores")}</strong><small>Choose which stores to include</small></div></div>
      <div className="deals-store-options" role="group" aria-label="Stores to watch">
        {dealStores.map((store) => <label className="deals-store-option" key={store.id}>
          <input type="checkbox" checked={deals.stores.includes(store.id as StoreId)} onChange={(event) => deals.setStore(store.id, event.target.checked)} />
          <span className="deals-store-check" aria-hidden="true" />
          <span><strong>{store.label}</strong>{!deals.detected.includes(store.id) && <small>Not detected in library</small>}</span>
        </label>)}
      </div>
    </section>
    <section className="deals-results">
      <div className="deals-subhead"><Tag size={15} aria-hidden="true" /><div><strong>{t("On sale")}</strong><small>Discounts across your selected stores</small></div><span className="deals-count">{sales.length}</span></div>
      {sales.length > 0 ? <div className="deals-offer-list">{sales.map((deal) => <article className="deals-offer" key={deal.dealId}>
        <div className="deals-offer-art"><Tag size={17} aria-hidden="true" /></div>
        <div className="deals-offer-copy"><strong><ExternalLink href={deal.link}>{deal.title}</ExternalLink></strong><small>{storeLabel(deal.storeId)}</small></div>
        <div className="deals-offer-price"><strong>{money(deal.salePrice)}</strong><span>{Math.round(deal.savings)}% off</span></div>
      </article>)}</div> : <div className="deals-empty-inline">{checking ? "Looking for current offers…" : deals.stores.length ? "No matching sales yet. Try refreshing later." : "Select a store above to see its offers."}</div>}
    </section>
    <section className="deals-results">
      <div className="deals-subhead"><Clock3 size={15} aria-hidden="true" /><div><strong>{t("Free on Epic")}</strong><small>Limited-time giveaways and upcoming offers</small></div><span className="deals-count">{free.length}</span></div>
      {free.length > 0 ? <div className="deals-offer-list">{free.map((game) => <article className="deals-offer" key={game.id}>
        <div className="deals-offer-art free"><Store size={17} aria-hidden="true" /></div>
        <div className="deals-offer-copy"><strong><ExternalLink href={game.url}>{game.title}</ExternalLink></strong><small>Epic Games Store</small></div>
        <div className="deals-offer-price"><span className={game.state === "free-now" ? "deals-free-now" : ""}>{game.state === "free-now" ? "Free now" : "Coming soon"}</span>{game.originalPrice && <small>Was {game.originalPrice}</small>}</div>
      </article>)}</div> : <div className="deals-empty-inline">{deals.stores.includes("epic") ? "No Epic giveaways available right now." : "Enable Epic Games Store above to see giveaways."}</div>}
    </section>
    {watched.length > 0 && <section className="deals-results">
      <div className="deals-subhead"><Heart size={15} aria-hidden="true" /><div><strong>{t("Price watches")}</strong><small>Games you are keeping an eye on</small></div><span className="deals-count">{watched.length}</span></div>
      <div className="deals-offer-list">{watched.map((item) => <article className="deals-offer" key={item.id}>
        <div className="deals-offer-art wishlist"><Heart size={17} aria-hidden="true" /></div>
        <div className="deals-offer-copy"><strong>{item.name}</strong><small>Target {money(item.priceWatch?.targetPrice ?? 0)}</small></div>
        <div className="deals-offer-price">{item.priceWatch?.lastPrice !== undefined ? <><strong>{money(item.priceWatch.lastPrice)}</strong><small>Current price</small></> : <span>Waiting for price</span>}</div>
      </article>)}</div>
    </section>}
    <footer className="deals-attribution">Sale data by <ExternalLink href="https://www.cheapshark.com">CheapShark <ExternalLinkIcon size={11} aria-hidden="true" /></ExternalLink> · Free games from Epic Games Store.</footer>
  </section>;
}

