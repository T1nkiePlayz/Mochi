# Game search (experimental)

Search any game, owned or not, from the command palette ("Search all games"). Off by default: turn on **Game search** in Settings > Experimental. It is offered only when an IGDB or SteamGridDB key is saved in Settings > Mod & metadata providers; without one the command is hidden.

## What a result shows

| Info | Source |
| --- | --- |
| Description, genres, release date, developers, platforms, rating, similar games, links, screenshots | IGDB (through the existing `store-provider-credentials` edge function and your stored key) |
| Covers, heroes, logos | SteamGridDB (same edge function) |
| Description/genres/developers/publishers/screenshots fallback | Steam Store `appdetails` (keyless) when the game has a Steam app id |
| Current Steam price | Steam `appdetails?filters=price_overview` (keyless, US region, USD) |
| Current best price and cheapest ever | CheapShark (keyless) |

IGDB and SteamGridDB provide no prices. The Steam app id comes from CheapShark's title match. Fields a provider does not return are simply omitted.

IGDB platforms, ratings, websites, developers and similar games need the extended field list in `supabase/functions/store-provider-credentials/index.ts`; until that function is redeployed those sections stay empty and everything else works.

## Price history graph

The graph is honest about its data. There is no keyless historical price source, so it combines:

- **Local observations**: each time you open a game, and each time the deal checker looks at a price-watched game, Mochi stores one observation (date, price, store, source) in `localStorage` (`mochi:price-history`). The same source and store is recorded at most once per 6 hours; at most 120 points per game and 60 games are kept (the oldest points and least recently updated games go first).
- **CheapShark lowest ever**: drawn as a dashed line.

The caption under the graph always reads "Local observations since <first date> (N points) + CheapShark lowest ever (<date>)". The line is the lowest USD price seen per day. Only USD is graphed, so Steam is requested for the US store. History therefore starts the first time you look at a game; it is not retroactive.

## Actions

- **Add to wishlist** uses `addToWishlist` (Steam app id when known).
- **Watch price** stores a target in the wishlist item's `priceWatch` through `watchPrice`; deal alerts (experimental "deal-alerts") then check it and notify.

## Performance, limits and terms

- Search is debounced by 300 ms and the previous request is cancelled; late answers are dropped.
- Details load only for the result you pick, one request at a time per provider (CheapShark and Steam share one throttled native client with a gap between requests, a one-hour response cache and a pause after HTTP 429; the edge function rate-limits per user).
- API data is cached in memory only (small LRU, 10-30 minutes). Only the local price observations are saved.
- Images are lazy-loaded and come from hosts already allowed by the CSP.
- Linux and macOS behave the same; nothing here is platform specific.
