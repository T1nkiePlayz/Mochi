import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { OnScreenKeyboard } from "../controller/OnScreenKeyboard";
import { subscribeActions } from "../controller/manager";
import { focusElement } from "../controller/spatial";
import { updateControllerSettings, useControllerSettings } from "../controller/settings";
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
import { exitBigPicture, quitMochi } from "./mode";
import { suspendSystem } from "./native";
import { playUiSound } from "./sounds";

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
  const [settings] = useControllerSettings();
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
  }, [lib.library, playtime, byId, games, query]);

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

  const play = useCallback((piko: Piko) => { if (!sessions.isRunning(piko.id)) void actions.launchGame(piko, { skipConfirm: true }); }, [actions, sessions]);
  const openGame = useCallback((piko: Piko) => { lastCard.current = piko.id; setPreview(""); setGameId(piko.id); }, []);
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
      const target = document.querySelector<HTMLElement>(".bp-menu [data-nav-default], .bp-menu .bp-menu-item");
      if (target) focusElement(target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menu]);

  const openMenu = () => { if (menu === "closed") returnFocus.current = document.activeElement as HTMLElement | null; setMenu("main"); };
  const closeMenu = () => setMenu("closed");

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
    if (event.action === "up" || event.action === "down" || event.action === "left" || event.action === "right") { playUiSound("move"); return false; }
    if (event.action === "confirm") { playUiSound("confirm"); return false; }
    switch (event.action) {
      case "back":
        playUiSound("back");
        if (menu === "themes") setMenu("main");
        else if (menu !== "closed") closeMenu();
        else if (preview) setPreview("");
        else if (gameId) setGameId(null);
        else if (query) setQuery("");
        return true;
      case "menu": playUiSound("open"); if (menu === "closed") openMenu(); else closeMenu(); return true;
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

  return <div className="bp-root" data-bp-root data-bp-screen={gameId ? "game" : "home"}>
    <div className="bp-backdrop" aria-hidden="true">
      {layers.map((id) => id === backdropId ? <BackdropLayer key={id} piko={byId.get(id)} override={preview} /> : <BackdropLayer key={id} piko={byId.get(id)} />)}
      <div className="bp-backdrop-scrim" />
    </div>
    <TopBar onMenu={openMenu} onSearch={() => { searchBackup.current = query; setSearching(true); }} query={query} nowPlaying={running[0] ?? null}
      onReturn={openGame} onStop={(piko) => void actions.stopRunningGame(piko)} activeDownloads={activeDownloads} />
    <main className="bp-stage bp-scroll" data-scroll-default>
      {game
        ? <GamePage piko={game} entry={entries.get(game.id)} running={sessions.isRunning(game.id)} busy={actions.isLaunching}
            onPlay={() => play(game)} onStop={() => void actions.stopRunningGame(game)} onFavorite={() => toggleFavorite(game.id)} onPreview={setPreview} />
        : <Home hero={hero} entryFor={(id) => entries.get(id)} shelves={shelves} query={query} isRunning={sessions.isRunning}
            onOpen={openGame} onPlay={play} onFocusCard={(piko) => { lastCard.current = piko.id; setFocusId(piko.id); }} onExit={() => leave()} />}
    </main>
    {launchError && <div className="bp-toast" role="alert">{launchError}</div>}
    <Legend items={legend} />
    {menu !== "closed" && <SideMenu view={menu} themes={themeEngine.themes} theme={themeEngine.theme} sounds={settings.uiSounds}
      canSuspend={platformCapabilities?.platform === "linux"} activeDownloads={activeDownloads}
      onTheme={(id) => void themeEngine.setTheme(id)} onShowThemes={() => setMenu("themes")} onSounds={() => updateControllerSettings({ uiSounds: !settings.uiSounds })}
      onLibrary={() => leave("Library")} onDownloads={() => leave("Downloads")} onControllerSettings={() => leave("Settings")}
      onSuspend={() => void suspendSystem().catch((error) => actions.setLaunchError(error instanceof Error ? error.message : String(error)))}
      onExit={() => leave()} onQuit={() => void quitMochi().catch(() => {})} onClose={closeMenu} />}
    {searching && <OnScreenKeyboard initial={query} label="Search games" onChange={setQuery} onSubmit={() => setSearching(false)} onCancel={() => { setQuery(searchBackup.current); setSearching(false); }} />}
  </div>;
}
