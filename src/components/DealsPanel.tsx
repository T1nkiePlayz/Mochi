import { RefreshCw } from "lucide-react";
import { useApp } from "../state/AppContext";
import { useWishlist } from "../lib/wishlist";
import { dealStores, filterDeals, storeLabel, watchedItems, type StoreId } from "../lib/deals";
import { openExternalUrl } from "../lib/platform";

const money = (value: number) => `$${value.toFixed(2)}`;
const SHOWN = 8;

function ExternalLink({ href, children, label }: { href: string; children: React.ReactNode; label?: string }) {
  return <a href={href} target="_blank" rel="noreferrer noopener" aria-label={label} onClick={(event) => { event.preventDefault(); void openExternalUrl(href).catch(() => undefined); }}>{children}</a>;
}

/** "Free & deals" section of the notification centre (experimental "deal-alerts"). Mounted only while the popover is open. */
export function DealsPanel() {
  const { deals } = useApp();
  const { items } = useWishlist();
  const watched = watchedItems(items);
  const sales = filterDeals(deals.deals, deals.stores).slice(0, SHOWN);
  const free = deals.stores.includes("epic") ? deals.epic : [];
  const checking = deals.status === "checking";
  const status = deals.status === "offline" ? "You are offline. Showing the last results." : deals.status === "error" ? deals.message || "Deals are unavailable right now." : deals.checkedAt ? `Checked ${new Date(deals.checkedAt).toLocaleString()}` : "Not checked yet.";
  return <section className="deals-panel" aria-label="Free and deals">
    <div className="notification-heading"><strong>Free &amp; deals</strong>
      <button type="button" className="deals-refresh" onClick={deals.refresh} disabled={checking} aria-label="Check for deals now"><RefreshCw size={12} aria-hidden="true" /> {checking ? "Checking" : "Check now"}</button>
    </div>
    <div className="deals-stores" role="group" aria-label="Stores to watch">
      {dealStores.map((store) => <label key={store.id}><input type="checkbox" checked={deals.stores.includes(store.id as StoreId)} onChange={(event) => deals.setStore(store.id, event.target.checked)} />{store.label}{deals.detected.includes(store.id) ? "" : " (not in library)"}</label>)}
    </div>
    <div className="notification-item" aria-live="polite"><span>{status}</span></div>
    {free.length > 0 && <div className="notification-item"><strong>Free on Epic</strong>
      {free.map((game) => <span key={game.id} className="deals-row"><ExternalLink href={game.url}>{game.title}</ExternalLink><span>{game.state === "free-now" ? "free now" : "coming soon"}{game.originalPrice ? `, was ${game.originalPrice}` : ""}</span></span>)}
    </div>}
    {sales.length > 0 && <div className="notification-item"><strong>On sale</strong>
      {sales.map((deal) => <span key={deal.dealId} className="deals-row"><ExternalLink href={deal.link}>{deal.title}</ExternalLink><span>{Math.round(deal.savings)}% off, {money(deal.salePrice)} on {storeLabel(deal.storeId)}</span></span>)}
    </div>}
    {!free.length && !sales.length && deals.status !== "checking" && <div className="notification-empty">{deals.stores.length ? "No deals to show yet." : "Pick a store above to see its deals."}</div>}
    {watched.length > 0 && <div className="notification-item"><strong>Price watches</strong>
      {watched.map((item) => <span key={item.id} className="deals-row"><span>{item.name}</span><span>target {money(item.priceWatch?.targetPrice ?? 0)}{item.priceWatch?.lastPrice !== undefined ? `, now ${money(item.priceWatch.lastPrice)}` : ""}</span></span>)}
    </div>}
    <div className="notification-item"><span>Deals by <ExternalLink href="https://www.cheapshark.com">CheapShark</ExternalLink>. Free games from the Epic Games Store.</span></div>
  </section>;
}
