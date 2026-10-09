import { useEffect, useRef, type RefObject } from "react";

type Options = {
  /** Extra areas (CSS selector) that count as inside, e.g. a trigger rendered elsewhere. */
  inside?: string;
  /** Close when focus moves outside or the window loses focus (default true). */
  focusLoss?: boolean;
  /** Element to focus after Escape; defaults to the root's `[aria-expanded]` trigger when focus was inside. */
  returnFocus?: RefObject<HTMLElement>;
};

// Open popovers, innermost last: Escape closes only the top one.
const stack: symbol[] = [];

/**
 * Shared dismissal for every popover, menu and dropdown: closes on a pointer press outside `ref`,
 * on Escape (innermost popover first, focus returns to its trigger), when focus moves outside, and
 * when the window loses focus. `ref` should wrap both the trigger and the popover so toggling works.
 */
export function useDismiss(ref: RefObject<HTMLElement>, active: boolean, close: () => void, options: Options = {}) {
  const latest = useRef(close);
  latest.current = close;
  const { inside, focusLoss = true, returnFocus } = options;
  useEffect(() => {
    if (!active) return;
    const id = Symbol("popover");
    stack.push(id);
    const contains = (node: EventTarget | null) => node instanceof Node && (Boolean(ref.current?.contains(node)) || Boolean(inside && node instanceof Element && node.closest(inside)));
    const onDown = (event: PointerEvent | MouseEvent) => { if (!contains(event.target)) latest.current(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || stack[stack.length - 1] !== id) return;
      event.stopPropagation(); event.preventDefault();
      const hadFocus = contains(document.activeElement);
      latest.current();
      if (hadFocus) (returnFocus?.current ?? ref.current?.querySelector<HTMLElement>("[aria-expanded='true']") ?? ref.current?.querySelector<HTMLElement>("[aria-expanded]"))?.focus({ preventScroll: true });
    };
    // focusin (not focusout) so clicks on non-focusable areas (WebKit does not focus clicked buttons) never count as leaving.
    const onFocusIn = (event: FocusEvent) => { if (!contains(event.target)) latest.current(); };
    const onBlur = () => latest.current();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    if (focusLoss) { document.addEventListener("focusin", onFocusIn); window.addEventListener("blur", onBlur); }
    return () => {
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("blur", onBlur);
    };
  }, [active, ref, inside, focusLoss, returnFocus]);
}
