# Deal alerts (experimental)

Free games and sales for the stores you use, plus price-watch alerts. Off by default: turn on **Settings > Experimental > Deal alerts**. The panel is the **Free & deals** section at the bottom of the notification popover.

## What it does
- **Free on Epic**: games that are free right now or announced as free next (a 100% promotion).
- **On sale**: current sales from CheapShark for Steam, GOG and Epic. Alerts are only raised for sales of 50% or more.
- **Price watches**: `watchPrice(item, targetPrice)` (src/lib/deals.ts) stores a target in the wishlist item's `priceWatch`; the same check compares the game's cheapest current price and alerts once when it reaches the target (and again only for a lower price). `getPriceInfo({ title | steamAppId })` returns current and cheapest-ever prices for the Game search feature.
- Alerts go through `notify(..., { group: "deals" })`, so a burst becomes one "N new deals" notification. Each alert is remembered (`mochi:deals-state`, 30 days) so it is only shown once.

## Which stores
Detected from your library sources (Steam, GOG, Epic; Heroic counts as Epic and GOG). You can switch any store on or off in the panel; the choice is kept in `mochi:deals-stores`.

## Schedule and limits
- First check about 8 seconds after start-up when the last one is older than 6 hours, then every 6 hours. Nothing runs when the feature is off or Mochi is offline; a failed check retries after 30 minutes. "Check now" runs one immediately.
- Natively (src-tauri/src/deals.rs): one shared HTTP client, one request at a time with at least 1.1 s between requests, in-memory cache for 1 hour (64 entries, never written to disk), 2 MB response cap, a 15 minute pause after HTTP 429. At most 20 price watches are checked per run (2 requests each).
- Prices are in USD (CheapShark). Only metadata is fetched; no images are loaded or stored, so the content security policy is unchanged.

## Sources and terms
- **CheapShark** (`https://www.cheapshark.com/api/1.0/deals`, `/games?title=`, `/games?steamAppID=`, `/games?id=` for `cheapestPriceEver`). Free, keyless public API (https://apidocs.cheapshark.com). It asks for a descriptive User-Agent (Mochi sends one) and attribution with links back through its redirect: the panel shows "Deals by CheapShark" and every deal link is `cheapshark.com/redirect?dealID=...`. Its robots.txt disallows `/api/1.0/` for crawlers; Mochi is a low-rate client of the documented API, not a crawler, and stays far under its limits.
- **Epic Games Store** free promotions feed (`https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions`). A public, undocumented JSON endpoint that the Epic store website itself uses; it has no published API terms. Mochi only reads promotion metadata (title, window, price text), at most a few times a day, links to the store page and does not copy artwork. The endpoint can change or disappear; parsing failures are shown as "unavailable".
