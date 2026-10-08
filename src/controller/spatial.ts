import type { Direction } from "./types";

export type Rect = { left: number; top: number; right: number; bottom: number };

const center = (rect: Rect) => ({ x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 });

/**
 * Picks the best neighbour of `from` in a direction. Prefers the closest element along the
 * direction of travel and penalises sideways drift, so moving down a grid stays in its column.
 */
export function pickNeighbor<T>(from: Rect, candidates: Array<{ item: T; rect: Rect }>, direction: Direction): T | null {
  const origin = center(from);
  const horizontal = direction === "left" || direction === "right";
  let best: T | null = null;
  let bestScore = Infinity;
  for (const { item, rect } of candidates) {
    const c = center(rect);
    const forward = direction === "right" ? c.x - origin.x : direction === "left" ? origin.x - c.x : direction === "down" ? c.y - origin.y : origin.y - c.y;
    if (forward <= 1) continue;
    // The candidate must extend beyond the near edge, otherwise a big container "contains" the move.
    const beyond = direction === "right" ? rect.right > from.right : direction === "left" ? rect.left < from.left : direction === "down" ? rect.bottom > from.bottom : rect.top < from.top;
    if (!beyond) continue;
    const gap = direction === "right" ? rect.left - from.right : direction === "left" ? from.left - rect.right : direction === "down" ? rect.top - from.bottom : from.top - rect.bottom;
    const side = horizontal ? Math.abs(c.y - origin.y) : Math.abs(c.x - origin.x);
    const overlaps = horizontal ? rect.top < from.bottom && rect.bottom > from.top : rect.left < from.right && rect.right > from.left;
    const score = Math.max(0, gap) + side * (overlaps ? 1 : 3) + (overlaps ? 0 : 200);
    if (score < bestScore) { bestScore = score; best = item; }
  }
  return best;
}

const FOCUSABLE = [
  "a[href]", "button", "input:not([type=hidden])", "textarea", "select", "summary",
  "[role=button]", "[role=tab]", "[role=switch]", "[role=menuitem]", "[role=checkbox]", "[role=radio]",
  "[tabindex]:not([tabindex='-1'])", "[data-nav]",
].join(",");

function isVisible(element: HTMLElement): boolean {
  if (element.closest("[inert], [aria-hidden=true], [hidden]")) return false;
  if (typeof element.checkVisibility === "function") return element.checkVisibility({ checkVisibilityCSS: true } as CheckVisibilityOptions);
  return element.getClientRects().length > 0;
}

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true";
}

/** Everything a controller can land on inside `scope`. */
export function focusablesIn(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (isDisabled(element) || (element.getAttribute("tabindex") === "-1" && !element.hasAttribute("data-nav"))) return false;
    // Dialogs outside the active scope must not be reachable.
    return isVisible(element) && element.getClientRects().length > 0;
  });
}

/** The container controller navigation is confined to: the top-most modal or custom scope, else the app. */
export function navScope(): HTMLElement {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>("[data-nav-scope], [role=dialog][aria-modal=true], .modal-backdrop"))
    .filter((element) => element.getClientRects().length > 0);
  return scopes[scopes.length - 1] ?? document.querySelector<HTMLElement>("[data-bp-root]") ?? document.body;
}

export function scrollParent(element: Element | null): HTMLElement {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

const reducedMotion = () => document.documentElement.getAttribute("data-reduce-motion") === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function focusElement(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}

/** Moves focus one step. Returns false when there was nowhere to go. */
export function moveFocus(direction: Direction): boolean {
  const scope = navScope();
  const all = focusablesIn(scope);
  if (!all.length) return false;
  const active = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement) ? document.activeElement : null;
  if (!active || active === document.body) {
    const preferred = scope.querySelector<HTMLElement>("[data-nav-default]");
    focusElement(preferred && all.includes(preferred) ? preferred : all[0]);
    return true;
  }
  const candidates = all.filter((element) => element !== active && !element.contains(active) && !active.contains(element)).map((item) => ({ item, rect: item.getBoundingClientRect() }));
  const target = pickNeighbor(active.getBoundingClientRect(), candidates, direction);
  if (target) { focusElement(target); return true; }
  // Nothing further that way: let long pages scroll instead.
  if (direction === "up" || direction === "down") {
    const parent = scrollParent(active);
    const before = parent.scrollTop;
    parent.scrollBy({ top: direction === "down" ? 160 : -160, behavior: reducedMotion() ? "auto" : "smooth" });
    return parent.scrollTop !== before || parent.scrollHeight > parent.clientHeight;
  }
  return false;
}
