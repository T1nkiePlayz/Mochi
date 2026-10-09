/**
 * Elements that truncate their text with an ellipsis get a `title` with the full text the first time the pointer
 * or keyboard focus reaches them, so long names never lose information. One delegated listener covers every
 * screen, theme and future component without touching each one.
 */
export function fillTruncationTitle(start: EventTarget | null): void {
  let el = start instanceof Element ? start : null;
  for (let depth = 0; el && depth < 4; depth += 1, el = el.parentElement) {
    if (el.hasAttribute("title") || el.hasAttribute("aria-label") || el.hasAttribute("data-no-title")) return;
    const style = getComputedStyle(el);
    if (style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) el.setAttribute("title", text);
      return;
    }
  }
}

export function installTruncationTitles(): () => void {
  const handler = (event: Event) => fillTruncationTitle(event.target);
  document.addEventListener("pointerover", handler, { passive: true });
  document.addEventListener("focusin", handler, { passive: true });
  return () => { document.removeEventListener("pointerover", handler); document.removeEventListener("focusin", handler); };
}
