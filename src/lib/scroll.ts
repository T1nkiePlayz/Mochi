/** The behavior for programmatic scrolls: "smooth" so the view glides to its target instead of
 * jumping, unless motion is reduced — the app's own toggle and the OS preference both count,
 * the same way controller navigation (controller/spatial.ts) already decides. */
export function scrollBehavior(): ScrollBehavior {
  const reduced = document.documentElement.getAttribute("data-reduce-motion") === "true" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return reduced ? "instant" : "smooth";
}
