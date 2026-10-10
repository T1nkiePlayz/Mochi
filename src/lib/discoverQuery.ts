/** Lets other parts of the app open Discover with its search box prefilled (command palette: "install mod <name>"). */
export const DISCOVER_QUERY_EVENT = "mochi:discover-query";
let pending = "";

/** The prefill waiting for Discover to mount. Read without clearing (render-safe, also under StrictMode); `clearDiscoverQuery` consumes it. */
export const peekDiscoverQuery = (): string => pending;
export function clearDiscoverQuery() { pending = ""; }

/** Switches to Discover and sets its search text. Works whether or not Discover is already mounted. */
export function openDiscoverWithQuery(query: string, setActiveNav: (nav: "Discover") => void) {
  pending = query;
  setActiveNav("Discover");
  window.dispatchEvent(new CustomEvent<string>(DISCOVER_QUERY_EVENT, { detail: query }));
}
