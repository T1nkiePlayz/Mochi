import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { createTypeAhead, gridKeyAction, pageRows, prefixMatch } from "../lib/gridKeys";
import { focusElement, pickNeighbor, scrollParent } from "../controller/spatial";

const CARD = ".game-card-main";

type Options = {
  /** Visible game ids in display order (the same order the cards are drawn in). */
  ids: readonly string[];
  names: ReadonlyMap<string, string>;
  play: (id: string) => void;
  toggleFavorite: (id: string) => void;
};

const idOf = (element: Element | null): string => element?.closest<HTMLElement>("[data-game-id]")?.dataset.gameId ?? "";

/**
 * Keyboard-first library grid: the grid is one Tab stop and arrow keys, Home/End, Page Up/Down and type-ahead move
 * between games; Shift+Enter plays, Ctrl+D favourites and `/` goes to search. A controller uses the same cards
 * through controller/spatial, so both behave alike.
 */
export function useGridKeyboard({ ids, names, play, toggleFavorite }: Options) {
  const [focusId, setFocusId] = useState("");
  const typeAhead = useRef(createTypeAhead());
  const tabId = focusId && ids.includes(focusId) ? focusId : ids[0] ?? "";

  const onFocus = useCallback((event: FocusEvent) => {
    const id = idOf(event.target as Element);
    if (id) setFocusId(id);
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches(CARD) && !target.matches(".game-card-heart")) return;
    const action = gridKeyAction(event.nativeEvent);
    if (!action) return;
    const grid = event.currentTarget;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(CARD));
    const current = cards.indexOf(target.matches(CARD) ? target : (target.closest("[data-game-id]")?.querySelector<HTMLElement>(CARD) ?? target));
    const go = (index: number) => {
      const next = cards[Math.max(0, Math.min(cards.length - 1, index))];
      if (next) focusElement(next);
    };
    const id = idOf(target);
    switch (action.type) {
      case "step": go(current + action.delta); break;
      case "edge": go(action.edge === "first" ? 0 : cards.length - 1); break;
      case "row":
      case "page": {
        const from = cards[current];
        if (!from) return;
        const direction = action.direction;
        const rect = from.getBoundingClientRect();
        const rows = action.type === "page" ? pageRows(scrollParent(from).clientHeight, rect.height + 12) : 1;
        let at = from;
        for (let step = 0; step < rows; step += 1) {
          const neighbor = pickNeighbor(at.getBoundingClientRect(), cards.filter((card) => card !== at).map((item) => ({ item, rect: item.getBoundingClientRect() })), direction);
          if (!neighbor) break;
          at = neighbor;
        }
        if (at !== from) focusElement(at);
        else if (direction === "down" && action.type === "page") go(cards.length - 1);
        else if (direction === "up" && action.type === "page") go(0);
        break;
      }
      case "play": if (id) play(id); break;
      case "favorite": if (id) toggleFavorite(id); break;
      case "search": document.querySelector<HTMLInputElement>(".search-box input")?.focus(); break;
      case "type": {
        const order = cards.map((card) => idOf(card));
        const index = prefixMatch(order.map((gameId) => names.get(gameId) ?? ""), current, typeAhead.current(action.char, Date.now()));
        if (index >= 0) go(index); else return;
        break;
      }
    }
    event.preventDefault();
  }, [names, play, toggleFavorite]);

  return { tabId, gridProps: { onKeyDown, onFocus } };
}
