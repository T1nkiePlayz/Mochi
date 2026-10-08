/**
 * Non-invasive accessibility enhancer. Observes the DOM so every dialog (`.modal` and the discover/picker windows)
 * gets role="dialog", aria-modal, an accessible name, initial focus, a Tab focus trap, Escape to close and focus
 * restoration, without each component having to implement it. Also names icon-only buttons from their title and
 * makes `role="button"` elements keyboard operable. Mounted once from App.tsx.
 */

const DIALOG = ".modal, .project-details-window, .tofu-picker-window, .nexus-game-picker-window, [role='dialog']";
const BACKDROP = ".modal-backdrop, .discover-modal-backdrop";
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";
const CLOSE = "[aria-label='Close' i], [aria-label*='close' i], [data-dialog-close], .modal-header .icon-button, .modal-header button, button.close, .secondary-button";

type Tracked = { opener: HTMLElement | null };
let seq = 0;

const visible = (el: HTMLElement) => !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);

function accessibleName(el: HTMLElement): string {
  return (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.textContent || "").trim();
}

function nameDialog(dialog: HTMLElement) {
  if (dialog.hasAttribute("aria-label") || dialog.hasAttribute("aria-labelledby")) return;
  const heading = dialog.querySelector<HTMLElement>("h1, h2, h3, [role='heading']");
  if (heading) {
    if (!heading.id) heading.id = `dialog-title-${++seq}`;
    dialog.setAttribute("aria-labelledby", heading.id);
  } else {
    dialog.setAttribute("aria-label", "Dialog");
  }
}

function closeDialog(dialog: HTMLElement): boolean {
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>(CLOSE)).filter((el) => visible(el) && !el.closest("form[data-no-escape]"));
  const labelled = buttons.find((el) => /close|cancel|dismiss|back|done/i.test(accessibleName(el)));
  const target = labelled ?? buttons.find((el) => el.matches(".modal-header .icon-button, .modal-header button, [aria-label*='close' i]"));
  if (target) { target.click(); return true; }
  const backdrop = dialog.closest<HTMLElement>(BACKDROP) ?? (dialog.parentElement?.matches(BACKDROP) ? dialog.parentElement : null);
  if (backdrop) {
    for (const type of ["mousedown", "mouseup", "click"]) backdrop.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    return true;
  }
  return false;
}

export function installAccessibilityEnhancer(): () => void {
  if (typeof document === "undefined") return () => undefined;
  const tracked = new Map<HTMLElement, Tracked>();

  const topDialog = (): HTMLElement | null => {
    const open = Array.from(tracked.keys()).filter((el) => el.isConnected);
    return open.length ? open[open.length - 1] : null;
  };

  const enhanceDialog = (dialog: HTMLElement) => {
    if (tracked.has(dialog)) return;
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    tracked.set(dialog, { opener: active });
    if (!dialog.hasAttribute("role")) dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    nameDialog(dialog);
    window.requestAnimationFrame(() => {
      if (!dialog.isConnected || dialog.contains(document.activeElement)) return;
      const first = dialog.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? focusables(dialog).find((el) => !el.matches("[aria-label*='close' i], .modal-header button, .icon-button")) ?? focusables(dialog)[0];
      if (first) first.focus();
      else { dialog.tabIndex = -1; dialog.focus(); }
    });
  };

  const releaseClosed = () => {
    let restored: HTMLElement | null = null;
    for (const [dialog, info] of tracked) {
      if (dialog.isConnected) continue;
      tracked.delete(dialog);
      restored = info.opener;
    }
    if (restored && !topDialog() && restored.isConnected) restored.focus({ preventScroll: true });
  };

  const nameControls = (root: ParentNode) => {
    root.querySelectorAll<HTMLElement>("button, a[href], [role='button']").forEach((el) => {
      if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby")) return;
      if ((el.textContent ?? "").trim()) return;
      const title = el.getAttribute("title");
      if (title) el.setAttribute("aria-label", title);
    });
    root.querySelectorAll<HTMLElement>("[role='button']:not([tabindex])").forEach((el) => el.setAttribute("tabindex", "0"));
    root.querySelectorAll<HTMLInputElement>("input:not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby])").forEach((el) => {
      if (el.labels?.length || el.type === "hidden") return;
      const hint = el.getAttribute("placeholder") || el.getAttribute("title");
      if (hint) el.setAttribute("aria-label", hint);
    });
  };

  const scan = (root: ParentNode) => {
    if (root instanceof HTMLElement && root.matches(DIALOG)) enhanceDialog(root);
    root.querySelectorAll<HTMLElement>(DIALOG).forEach(enhanceDialog);
    nameControls(root);
  };

  let queued = false;
  const pending = new Set<Node>();
  const flush = () => {
    queued = false;
    pending.forEach((node) => { if (node.isConnected && node instanceof HTMLElement) scan(node); });
    pending.clear();
    releaseClosed();
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach((node) => { if (node instanceof HTMLElement) pending.add(node); });
    if (!queued) { queued = true; window.requestAnimationFrame(flush); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if ((event.key === "Enter" || event.key === " ") && target?.matches("[role='button']") && !target.matches("button, a, input, textarea")) {
      event.preventDefault();
      target.click();
      return;
    }
    const dialog = topDialog();
    if (!dialog) return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      // Let open popups (select menus, dropdowns) handle their own Escape first.
      if (target?.closest("[role='listbox'], [role='menu']") || dialog.querySelector("[aria-expanded='true']")) return;
      if (closeDialog(dialog)) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(dialog);
    if (!items.length) { event.preventDefault(); dialog.focus(); return; }
    const first = items[0]; const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active || !dialog.contains(active)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey, true);

  return () => { observer.disconnect(); document.removeEventListener("keydown", onKey, true); tracked.clear(); };
}
