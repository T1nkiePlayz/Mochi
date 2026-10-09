import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { OnScreenKeyboard } from "../controller/OnScreenKeyboard";
import { subscribeActions } from "../controller/manager";
import { focusElement } from "../controller/spatial";
import type { ActionEvent } from "../controller/types";
import { gameSearchMatches } from "../lib/search";
import type { Piko } from "../models";
import { BackdropLayer } from "./Art";
import { GamePage } from "./GamePage";
import { Home, type ShelfData } from "./Home";
import { Legend, type LegendItem } from "./Legend";
import { SideMenu, type MenuView } from "./SideMenu";
import { TopBar } from "./TopBar";
import { isLauncher } from "./hooks";
import { exitBigPicture, isGamescopeSession, quitMochi } from "./mode";
import { getPowerCapabilities, minimizeWindow, powerAction, toggleFullscreen, type PowerCapabilities } from "./native";
import { playSound, useSoundSettings } from "../lib/sound";
import { useSoundPacks } from "../lib/sound/useSoundPacks";
import { useDisplaySettings } from "./display";

const HOME_LEGEND: LegendItem[] = [
  { action: "confirm", label: "Open" }, { action: "x", label: "Favourite" }, { action: "y", label: "Search" },
  { action: "tabPrev", label: "Previous shelf" }, { action: "tabNext", label: "Next shelf" }, { action: "menu", label: "Menu" },
];
const GAME_LEGEND: LegendItem[] = [{ action: "confirm", label: "Select" }, { action: "back", label: "Back" }, { action: "x", label: "Favourite" }, { action: "menu", label: "Menu" }];
const MENU_LEGEND: LegendItem[] = [{ action: "confirm", label: "Select" }, { action: "back", label: "Close" }];

const shelfSize = 16;

export default function BigPicture() {
  const app = useApp();
  const { lib, playtime, sessions, actions, themeEngine, downloads, platformCapabilities, setActiveNav } = app;
  const [sound, updateSound] = useSoundSettings();
  const { packs: soundPacks } = useSoundPacks();
  const [display, updateDisplay] = useDisplaySettings();
  const [power, setPower] = useState<PowerCapabilities | null>(null);
  useEffect(() => { void getPowerCapabilities().then(setPower).catch(() => setPower(null)); }, []);
  const [gameId, setGameId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuView>("closed");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState("");
  const [preview, setPreview] = useState("");
  const [layers, setLayers] = useState<string[]>([]);
  const lastCard = useRef("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const searchBackup = useRef("");

  const byId = useMemo(() => new Map(lib.library.map((piko) => [piko.id, piko])), [lib.library]);
  const entries = useMemo(() => new Map(playtime.map((entry) => [entry.gameId, entry])), [playtime]);
  const games = useMemo(() => lib.library.filter((piko) => !isLauncher(piko)), [lib.library]);

  const shelves = useMemo<ShelfData[]>(() => {
    const needle = query.trim();
    if (needle) {
      const hits = lib.library.filter((piko) => [piko.name, piko.platformCategory ?? "", ...(piko.categories ?? []), ...(piko.tags ?? [])].some((value) => gameSearchMatches(needle, value)));
      return [{ id: "search", title: "Results", items: hits }];
    }
    if (display.layout === "grid") {
      const byName = (a: Piko, b: Piko) => a.name.localeCompare(b.name);
      return [
        { id: "favourites", title: "Favourites", items: games.filter((piko) => piko.favorite).sort(byName) },
        { id: "all", title: "All games", items: [...games].sort(byName) },
        { id: "launchers", title: "Launchers", items: lib.library.filter(isLauncher).sort(byName) },
      ];
    }
    const recent = playtime.filter((entry) => entry.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed)
      .map((entry) => byId.get(entry.gameId)).filter((piko): piko is Piko => Boolean(piko) && !isLauncher(piko!));
    const byPlatform = new Map<string, Piko[]>();
    games.forEach((piko) => { const key = piko.platformCategory || "Other"; byPlatform.set(key, [...(byPlatform.get(key) ?? []), piko]); });
    return [
      { id: "continue", title: "Continue playing", items: recent.slice(0, shelfSize) },
      { id: "favourites", title: "Favourites", items: games.filter((piko) => piko.favorite) },
      { id: "recent", title: "Recently added", items: [...games].reverse().slice(0, shelfSize) },
      ...[...byPlatform.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, items]) => ({ id: `platform:${name}`, title: byPlatform.size === 1 ? "All games" : name, items })),
      { id: "launchers", title: "Launchers", items: lib.library.filter(isLauncher) },
    ];
  }, [lib.library, playtime, byId, games, query, display.layout]);

  const lastPlayed = shelves.find((shelf) => shelf.id === "continue")?.items[0];
  const hero = byId.get(focusId) ?? lastPlayed ?? games[0] ?? lib.library[0];
  const game = gameId ? byId.get(gameId) : undefined;
  const backdropPiko = game ?? hero;
  const running = sessions.sessions.map((session) => byId.get(session.gameId)).filter((piko): piko is Piko => Boolean(piko));
  const activeDownloads = downloads.filter((download) => download.status === "downloading").length;

  // Crossfade: keep the previous backdrop underneath while the next one fades in.
  const backdropId = backdropPiko?.id ?? "";
  useEffect(() => {
    if (!backdropId) return;
    setLayers((current) => [...current.filter((id) => id !== backdropId).slice(-1), backdropId]);
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), 900);
    return () => window.clearTimeout(timer);
  }, [backdropId]);

  const play = useCallback((piko: Piko, tofuId?: string) => {
    if (sessions.isRunning(piko.id)) return;
    playSound("launch");
    void actions.launchGame(piko, { skipConfirm: true, tofuId });
  }, [actions, sessions]);
  const openGame = useCallback((piko: Piko) => { lastCard.current = piko.id; setPreview(""); setGameId(piko.id); }, []);
  const focusCard = useCallback((piko: Piko) => { lastCard.current = piko.id; setFocusId(piko.id); }, []);
  const toggleFavorite = useCallback((id: string) => { const piko = byId.get(id); if (piko) lib.updateGame(id, { favorite: !piko.favorite }); }, [byId, lib]);

  // Focus follows the screen: the Play button on a game page, the card you came from on the home screen.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const root = document.querySelector<HTMLElement>("[data-bp-root]");
      const target = gameId
        ? root?.querySelector<HTMLElement>(".bp-game [data-nav-default]")
        : root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(lastCard.current)}"]`) ?? root?.querySelector<HTMLElement>("[data-nav-default]");
      if (target) focusElement(target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [gameId, hero ? "has-hero" : "no-hero"]);

  useEffect(() => {
    if (menu === "closed") { returnFocus.current?.focus({ preventScroll: true }); return; }
    if (!returnFocus.current || !returnFocus.current.isConnected) returnFocus.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(".bp-menu [data-nav-default]") ?? document.querySelector<HTMLElement>(".bp-menu .bp-menu-item");
      if (target) focusElement(target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menu]);

  const openMenu = () => { if (menu === "closed") { returnFocus.current = document.activeElement as HTMLElement | null; playSound("open"); } setMenu("main"); };
  const closeMenu = () => { if (menu !== "closed") playSound("close"); setMenu("closed"); };

  const jumpShelf = (step: 1 | -1) => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-shelf]"));
    if (!sections.length) return;
    const current = sections.findIndex((section) => section.contains(document.activeElement));
    const next = sections[Math.min(sections.length - 1, Math.max(0, (current < 0 ? (step > 0 ? -1 : sections.length) : current) + step))];
    const target = next.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(lastCard.current)}"]`) ?? next.querySelector<HTMLElement>(".bp-card");
    if (target) focusElement(target);
  };

  const focusedCardId = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId ?? "";

  const handle = (event: ActionEvent): boolean => {
    switch (event.action) {
      case "back":
        if (menu !== "closed" && menu !== "main") setMenu("main");
        else if (menu !== "closed") setMenu("closed");
        else if (preview) setPreview("");
        else if (gameId) setGameId(null);
        else if (query) setQuery("");
        return true;
      case "menu": if (menu === "closed") openMenu(); else closeMenu(); return true;
      case "options": case "y":
        if (menu === "closed" && !gameId) { searchBackup.current = query; setSearching(true); }
        return true;
      case "x": {
        if (menu !== "closed") return true;
        const id = gameId ?? focusedCardId() ?? "";
        if (id) toggleFavorite(id);
        return true;
      }
      case "tabPrev": case "tabNext":
        if (menu === "closed" && !gameId) jumpShelf(event.action === "tabNext" ? 1 : -1);
        return true;
      default: return false;
    }
  };
  const handler = useRef(handle);
  handler.current = handle;
  useEffect(() => subscribeActions((event) => handler.current(event), 50), []);

  // Launch problems are shown on screen and clear themselves.
  const { launchError, setLaunchError } = actions;
  useEffect(() => {
    if (!launchError) return;
    const timer = window.setTimeout(() => setLaunchError(""), 7000);
    return () => window.clearTimeout(timer);
  }, [launchError, setLaunchError]);

  const leave = (nav?: "Library" | "Downloads" | "Settings") => { if (nav) setActiveNav(nav); exitBigPicture(); };
  const legend = searching ? [] : menu !== "closed" ? MENU_LEGEND : gameId ? GAME_LEGEND : HOME_LEGEND;
  const reportError = (error: unknown) => { playSound("error"); actions.setLaunchError(error instanceof Error ? error.message : String(error)); };

  return <div className="bp-root" data-bp-root data-bp-screen={gameId ? "game" : "home"}
    data-bp-layout={display.layout} data-bp-tile={display.shape} data-bp-size={display.size} data-bp-titles={display.titles}>
    <div className="bp-backdrop" aria-hidden="true">
      {layers.map((id) => id === backdropId ? <BackdropLayer key={id} piko={byId.get(id)} override={preview} /> : <BackdropLayer key={id} piko={byId.get(id)} />)}
      <div className="bp-backdrop-scrim" />
    </div>
    <TopBar onMenu={openMenu} onSearch={() => { searchBackup.current = query; setSearching(true); }} query={query} nowPlaying={running[0] ?? null}
      onReturn={openGame} onStop={(piko) => void actions.stopRunningGame(piko)} activeDownloads={activeDownloads} />
    <main className="bp-stage bp-scroll" data-scroll-default>
      {game
        ? <GamePage piko={game} entry={entries.get(game.id)} running={sessions.isRunning(game.id)} busy={actions.isLaunching}
            onPlay={(tofuId) => play(game, tofuId)} onStop={() => void actions.stopRunningGame(game)} onFavorite={() => toggleFavorite(game.id)} onPreview={setPreview} />
        : <Home hero={hero} entryFor={(id) => entries.get(id)} shelves={shelves} query={query} isRunning={sessions.isRunning} grid={display.layout === "grid" || Boolean(query)}
            onOpen={openGame} onPlay={play} onFocusCard={focusCard} onExit={() => leave()} />}
    </main>
    {launchError && <div className="bp-toast" role="alert">{launchError}</div>}
    <Legend items={legend} />
    {menu !== "closed" && <SideMenu view={menu} themes={themeEngine.themes} theme={themeEngine.theme} sound={sound} soundPacks={soundPacks} display={display}
      power={power} macos={platformCapabilities?.platform === "macos"} windowControls={!isGamescopeSession()} activeDownloads={activeDownloads}
      onView={setMenu} onTheme={(id) => void themeEngine.setTheme(id)} onSound={updateSound} onDisplay={updateDisplay}
      onLibrary={() => leave("Library")} onDownloads={() => leave("Downloads")} onControllerSettings={() => leave("Settings")}
      onPower={(action) => { closeMenu(); void powerAction(action).catch(reportError); }}
      onMinimize={() => void minimizeWindow().catch(reportError)} onFullscreen={() => void toggleFullscreen().catch(reportError)}
      onExit={() => leave()} onQuit={() => void quitMochi().catch(() => {})} onClose={closeMenu} />}
    {searching && <OnScreenKeyboard initial={query} label="Search games" onChange={setQuery} onSubmit={() => setSearching(false)} onCancel={() => { setQuery(searchBackup.current); setSearching(false); }} />}
  </div>;
}
