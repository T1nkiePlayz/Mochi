import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { shallowEqual, useAppGetter, useAppSelector } from "../state/AppContext";
import { commandsVersion, listCommands, subscribeCommands } from "../lib/commands";
import { registerBuiltinCommands, registerLaunchProfileCommands, registerThemeCommands } from "../lib/builtinCommands";
import { OPEN_PALETTE_EVENT, parsePaletteQuery, paletteShortcutLabel, rankPalette, readRecents, rememberAction, type PaletteItem } from "../lib/palette";
import { useBigPictureActive } from "../bigpicture/mode";
import { useTranslation } from "../lib/useTranslation";

/**
 * Ctrl/Cmd+K command palette: games and actions in one list. ">" shows actions only. Rows are real buttons, so keyboard,
 * D-pad (spatial navigation) and A/B all work: arrows move focus, Enter/A runs, Escape/B closes (via the dialog enhancer).
 */
export function CommandPalette() {
  const { themes, setupOpen, platform } = useAppSelector((app) => ({ themes: app.themeEngine.themes, setupOpen: app.showFirstLaunchSetup, platform: app.platformCapabilities?.platform }), shallowEqual);
  const getApp = useAppGetter();
  const bigPicture = useBigPictureActive();
  const [open, setOpen] = useState(false);
  useEffect(() => registerBuiltinCommands(), []);
  const themeKey = themes.map((theme) => `${theme.id}:${theme.name}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerThemeCommands(themes, (id) => void getApp().themeEngine.setTheme(id)), [themeKey, getApp]);

  const profileGames = useAppSelector((app) => app.lib.library.filter((piko) => piko.launchProfiles?.length).map((piko) => `${piko.id}\u0001${piko.name}\u0001${piko.activeLaunchProfile ?? ""}\u0001${piko.launchProfiles!.map((profile) => `${profile.id}\u0002${profile.name}`).join("\u0003")}`).join("\u0004"));
  useEffect(() => registerLaunchProfileCommands(getApp().lib.library.filter((piko) => piko.launchProfiles?.length), (gameId, profileId) => getApp().lib.updateGame(gameId, { activeLaunchProfile: profileId })), [profileGames, getApp]);

  const disabled = setupOpen || bigPicture;
  useEffect(() => {
    if (disabled) { setOpen(false); return; }
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen((value) => !value); }
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(OPEN_PALETTE_EVENT, show); };
  }, [disabled]);
  if (!open || disabled) return null;
  return <PaletteDialog getApp={getApp} platform={platform} onClose={() => setOpen(false)} />;
}

function PaletteDialog({ getApp, platform, onClose }: { getApp: ReturnType<typeof useAppGetter>; platform?: string; onClose: () => void }) {
  const t = useTranslation();
  const [raw, setRaw] = useState("");
  const deferred = useDeferredValue(raw);
  const [recents] = useState(readRecents);
  const registryVersion = useSyncExternalStore(subscribeCommands, commandsVersion, commandsVersion);
  const library = useAppSelector((app) => app.lib.library);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const context = useMemo(() => ({ app: getApp }), [getApp]);
  // `when` is evaluated when the palette opens or the registry changes; the library is read live at run time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => listCommands(context), [context, registryVersion, library]);
  const items = useMemo(() => rankPalette({ raw: deferred, commands, games: library, recents }), [deferred, commands, library, recents]);
  const { mode } = parsePaletteQuery(raw);

  const run = useCallback((item: PaletteItem) => {
    onClose();
    const app = getApp();
    if (item.kind === "command") { if (!item.command.id.endsWith("install-query")) rememberAction(item.command.id); void Promise.resolve(item.command.run(context)).catch((error) => app.notifications.notify("Command failed", error instanceof Error ? error.message : String(error))); return; }
    app.lib.selectPiko(item.piko, item.kind === "tofu" ? item.tofuId : undefined);
    app.setActiveNav("Library");
    if (item.kind === "tofu") app.setShowTofuManager(true); else app.lib.setGameDetailsId(item.piko.id);
  }, [context, getApp, onClose]);

  const rows = () => Array.from(list.current?.querySelectorAll<HTMLElement>(".palette-item") ?? []);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    const target = event.target as HTMLElement;
    const inInput = target === input.current;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const all = rows(); const at = all.indexOf(target); const step = event.key === "ArrowDown" ? 1 : -1;
      event.preventDefault();
      if (inInput) all[step === 1 ? 0 : all.length - 1]?.focus();
      else if (at + step < 0) input.current?.focus(); else all[at + step]?.focus();
    } else if (event.key === "Enter" && inInput) {
      event.preventDefault();
      const first = items[0]; if (first) run(first);
    } else if (!inInput && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) input.current?.focus();
  };

  return <div className="modal-backdrop palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal palette-modal" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
      <div className="palette-search">
        <Search size={16} aria-hidden="true" />
        <input ref={input} data-autofocus value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={mode === "actions" ? t("Run an action…") : t("Search games and actions, or type > for actions")} aria-label="Search games and actions" role="combobox" aria-expanded="true" aria-controls="palette-list" autoComplete="off" spellCheck={false} />
        <kbd>{paletteShortcutLabel(platform)}</kbd>
        <button type="button" className="icon-button" aria-label="Close command palette" onClick={onClose}><X size={15} aria-hidden="true" /></button>
      </div>
      <div className="palette-list" id="palette-list" role="listbox" aria-label="Results" ref={list}>
        {items.map((item) => <button type="button" role="option" aria-selected="false" className="palette-item" data-kind={item.kind} key={item.key} onClick={() => run(item)}><span className="palette-title">{item.title}</span><small>{item.subtitle}</small></button>)}
        {!items.length && <div className="palette-empty" role="status">{raw.trim() ? "Nothing matches. Try a different word." : "No actions available."}</div>}
      </div>
      <div className="palette-hint" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Esc</kbd> close</span><span><kbd>&gt;</kbd> actions only</span></div>
    </div>
  </div>;
}
