import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Gift, Search, X } from "lucide-react";
import { useApp } from "../state/AppContext";
import { supabase } from "../lib/supabase";
import { RemoteImage } from "./RemoteImage";
import { sameWish, useWishlist, type WishlistInput } from "../lib/wishlist";
import { unwatchPrice, watchPrice } from "../lib/deals";
import { openExternalUrl } from "../lib/platform";
import { useTranslation } from "../lib/useTranslation";
import {
  buildChart, createDebouncedSearch, createProviderBackend, dailyLowest, gameSearchAvailable, gameSearchBackendOverride, historyCaption, historyKey,
  observationsFromPrices, recordObservations, type GameDetails, type GameSearchBackend, type PriceObservation, type SearchHit,
} from "../lib/gameSearch";

const money = (value: number) => `$${value.toFixed(2)}`;
const fullDate = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer noopener" onClick={(event) => { event.preventDefault(); void openExternalUrl(href).catch(() => undefined); }}>{children}</a>;
}

function PriceChart({ observations, ever, everDate }: { observations: PriceObservation[]; ever: number | null; everDate: number | null }) {
  const t = useTranslation();
  const points = useMemo(() => dailyLowest(observations), [observations]);
  const chart = useMemo(() => buildChart(points, ever), [points, ever]);
  const caption = historyCaption(observations, everDate, t);
  if (!points.length && ever === null) return <p className="game-search-muted">No price data yet. {caption}</p>;
  return <figure className="game-search-chart">
    <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={t("Price history. {caption} Lowest {min}, highest {max}.").replace("{caption}", caption).replace("{min}", money(chart.min)).replace("{max}", money(chart.max))} preserveAspectRatio="none">
      {chart.everY !== null && <line className="game-search-ever" x1="0" x2={chart.width} y1={chart.everY} y2={chart.everY} />}
      {chart.dots.length > 1 && <path className="game-search-line" d={chart.line} fill="none" />}
      {chart.dots.map((dot) => <circle key={dot.t} className="game-search-dot" cx={dot.x} cy={dot.y} r="3"><title>{`${new Date(dot.t).toLocaleDateString()}: ${money(dot.price)}`}</title></circle>)}
    </svg>
    <figcaption>{caption}{ever !== null && <> {t("Dashed line: lowest ever, {price}.").replace("{price}", money(ever))}</>}</figcaption>
  </figure>;
}

function Gallery({ title, urls, wide }: { title: string; urls: Array<{ thumb: string; url: string }>; wide?: boolean }) {
  if (!urls.length) return null;
  return <section aria-label={title}><h4>{title}</h4><div className={`game-search-strip${wide ? " wide" : ""}`}>
    {urls.map((item) => <Link key={item.url} href={item.url}><RemoteImage src={item.thumb} alt="" referrerPolicy="no-referrer" /></Link>)}
  </div></section>;
}

function Details({ game, onSearch }: { game: GameDetails; onSearch: (name: string) => void }) {
  const t = useTranslation();
  const wishlist = useWishlist();
  const [observations, setObservations] = useState<PriceObservation[]>([]);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const key = historyKey(game);
  useEffect(() => {
    // Recording is the only write: one point per source and store every few hours, for the games the user actually opens.
    setObservations(recordObservations(key, observationsFromPrices(game.prices, Date.now())));
  }, [game, key]);
  const current = [game.prices.steam ? game.prices.steam.final / 100 : null, game.prices.shark?.cheapestNow ?? null].filter((p): p is number => p !== null);
  const lowestNow = current.length ? Math.min(...current) : null;
  const wishInput = (): WishlistInput => ({ name: game.name, source: game.steamAppId ? "steam" : "igdb", externalId: game.steamAppId ? String(game.steamAppId) : undefined, coverUrl: game.coverUrl?.startsWith("https://") ? game.coverUrl : undefined });
  const addWish = () => { setNote(wishlist.add(wishInput()) ? t("On your wishlist.") : t("Could not add it to the wishlist.")); };
  const watch = () => {
    const value = Number(target.replace(",", "."));
    if (!(value > 0)) { setNote(t("Enter a target price above 0.")); return; }
    setNote(watchPrice(wishInput(), value) ? t("Watching for {price} or less. Deal alerts check every few hours.").replace("{price}", money(value)) : t("Could not start the price watch."));
  };
  const stored = wishlist.items.find((item) => sameWish(item, wishInput()));
  const ever = game.prices.shark?.cheapestEver ?? null;
  return <article className="game-search-details" aria-label={game.name}>
    {game.heroUrl && <div className="game-search-hero"><RemoteImage src={game.heroUrl} alt="" referrerPolicy="no-referrer" /></div>}
    <header className="game-search-title">
      {game.coverUrl && <RemoteImage className="game-search-cover" src={game.coverUrl} alt="" referrerPolicy="no-referrer" />}
      <div><h3>{game.name}</h3>
        <p className="game-search-muted">{[game.releaseDate ? fullDate(game.releaseDate) : "", game.developers.join(", ")].filter(Boolean).join(" · ") || t("No release or developer info")}</p>
        {game.rating && <p><strong>{game.rating.score}</strong>/100 on IGDB{game.rating.count ? ` (${t(game.rating.count === 1 ? "{count} rating" : "{count} ratings").replace("{count}", String(game.rating.count))})` : ""}</p>}
      </div>
    </header>
    <div className="game-search-actions">
      <button type="button" className="secondary-button" onClick={addWish} disabled={Boolean(stored)}><Gift size={14} aria-hidden="true" /> {stored ? t("On wishlist") : t("Add to wishlist")}</button>
      <label className="game-search-target">{t("Alert me at")} <input className="compact-input" inputMode="decimal" placeholder={lowestNow ? (lowestNow * 0.8).toFixed(2) : "9.99"} value={target} onChange={(event) => setTarget(event.target.value)} aria-label={t("Target price in USD")} /> USD</label>
      <button type="button" className="secondary-button" onClick={watch}><Bell size={14} aria-hidden="true" /> {t("Watch price")}</button>
      {stored?.priceWatch?.targetPrice !== undefined && <button type="button" className="secondary-button" onClick={() => { unwatchPrice(stored.id); setNote(t("Price watch removed.")); }}><BellOff size={14} aria-hidden="true" /> {t("Stop watching ({price})").replace("{price}", money(stored.priceWatch.targetPrice))}</button>}
    </div>
    <p className="game-search-muted" role="status" aria-live="polite">{note}</p>
    {game.description && <p className="game-search-description">{game.description}</p>}
    <dl className="game-search-facts">
      {game.genres.length > 0 && <><dt>Genres</dt><dd>{game.genres.join(", ")}</dd></>}
      {game.platforms.length > 0 && <><dt>Platforms</dt><dd>{game.platforms.join(", ")}</dd></>}
      {game.publishers.length > 0 && <><dt>Publishers</dt><dd>{game.publishers.join(", ")}</dd></>}
    </dl>
    <section aria-label="Prices"><h4>Prices</h4>
      <ul className="game-search-prices">
        {game.prices.steam && <li><span>Steam (US)</span><span>{game.prices.steam.formatted || money(game.prices.steam.final / 100)}{game.prices.steam.discountPercent > 0 && ` (-${game.prices.steam.discountPercent}%)`}</span></li>}
        {game.prices.shark && game.prices.shark.cheapestNow !== null && <li><span>Cheapest now (CheapShark)</span><span>{money(game.prices.shark.cheapestNow)}</span></li>}
        {ever !== null && <li><span>Cheapest ever (CheapShark)</span><span>{money(ever)}</span></li>}
      </ul>
      {!game.prices.steam && !game.prices.shark && <p className="game-search-muted">No price found (the game may be free, unreleased or not sold on tracked stores).</p>}
      <PriceChart observations={observations} ever={ever} everDate={game.prices.shark?.cheapestEverDate ?? null} />
    </section>
    <Gallery title="Screenshots" urls={game.screenshots.map((url) => ({ thumb: url, url }))} wide />
    <Gallery title="Covers" urls={game.art.covers.map((a) => ({ thumb: a.thumb, url: a.url }))} />
    <Gallery title="Heroes" urls={game.art.heroes.map((a) => ({ thumb: a.thumb, url: a.url }))} wide />
    <Gallery title="Logos" urls={game.art.logos.map((a) => ({ thumb: a.thumb, url: a.url }))} />
    {game.similar.length > 0 && <section aria-label={t("Similar games")}><h4>{t("Similar games")}</h4><div className="game-search-similar">
      {game.similar.map((item) => <button key={item.name} type="button" className="secondary-button" onClick={() => onSearch(item.name)}>{item.name}</button>)}
    </div></section>}
    {game.links.length > 0 && <section aria-label="Links"><h4>Links</h4><p className="game-search-links">{game.links.map((link) => <Link key={link.url} href={link.url}>{link.label}</Link>)}</p></section>}
    <p className="game-search-muted">Data from {game.sources.join(", ") || t("no provider")}. Artwork belongs to its authors.</p>
  </article>;
}

export function GameSearchDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslation();
  const { credentials } = useApp();
  const ready = { igdb: credentials.status.igdb, steamgriddb: credentials.status.steamgriddb };
  const backend: GameSearchBackend | null = useMemo(() => gameSearchBackendOverride() ?? (supabase && gameSearchAvailable(ready) ? createProviderBackend(supabase, ready) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready.igdb, ready.steamgriddb]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [game, setGame] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); return () => detailAbort.current?.abort(); }, []);

  const search = useMemo(() => createDebouncedSearch(
    (text, signal) => (backend ? backend.search(text, signal) : Promise.reject(new Error(t("No provider is set up.")))),
    {
      onStart: () => setStatus("searching"),
      onResult: (_text, result) => { setHits(result); setStatus("done"); setMessage(""); },
      onError: (_text) => { setStatus("error"); setHits([]); setMessage(t("Search failed.")); },
      onClear: () => { setHits([]); setStatus("idle"); setMessage(""); },
    },
  ), [backend, t]);
  useEffect(() => () => search.cancel(), [search]);

  const type = (text: string) => { setQuery(text); search.call(text); };
  const pick = (hit: SearchHit) => {
    if (!backend) return;
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setLoading(hit.name); setMessage("");
    backend.details(hit, controller.signal).then((details) => { if (!controller.signal.aborted) { setGame(details); setLoading(null); } })
      .catch(() => { if (!controller.signal.aborted) { setLoading(null); setMessage(t("Could not load the game.")); } });
  };

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal game-search-dialog" role="dialog" aria-modal="true" aria-labelledby="game-search-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><p className="eyebrow">Experimental</p><h2 id="game-search-title">{t("Search all games")}</h2></div><button type="button" className="icon-button" aria-label={t("Close game search")} onClick={onClose}><X size={16} aria-hidden="true" /></button></div>
      <div className="game-search-body">
        <div className="game-search-side">
          <label className="search-box game-search-input"><Search size={15} aria-hidden="true" /><input ref={input} value={query} onChange={(event) => type(event.target.value)} placeholder="Search any game" aria-label="Search any game" autoComplete="off" spellCheck={false} /></label>
          <div className="game-search-status" role="status" aria-live="polite">{status === "searching" ? t("Searching…") : status === "done" && !hits.length ? t("No games found.") : message}</div>
          <ul className="game-search-hits" aria-label="Search results">
            {hits.map((hit) => <li key={hit.key}><button type="button" className={`game-search-hit${game?.key === hit.key ? " active" : ""}`} onClick={() => pick(hit)} aria-current={game?.key === hit.key ? "true" : undefined}>
              {hit.coverUrl ? <RemoteImage src={hit.coverUrl} alt="" referrerPolicy="no-referrer" fallback={<span className="game-search-nocover" />} /> : <span className="game-search-nocover" />}
              <span><strong>{hit.name}</strong><small>{hit.year ?? t("Unknown year")}</small></span></button></li>)}
          </ul>
        </div>
        <div className="game-search-main" aria-busy={Boolean(loading)}>
          {loading ? <p className="game-search-muted" role="status">{t("Loading {name}…").replace("{name}", loading)}</p> : game ? <Details key={game.key} game={game} onSearch={(name) => { type(name); input.current?.focus(); }} />
            : <p className="game-search-muted">Type a game name, then pick a result for its details, artwork and prices.</p>}
        </div>
      </div>
    </div>
  </div>;
}
