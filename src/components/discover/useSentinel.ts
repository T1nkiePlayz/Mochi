import { useEffect, useRef } from "react";

/**
 * Calls `onVisible` when the returned element nears the viewport. Re-arms on every
 * `watch` change so a sentinel that is still on screen after a page loads fires again.
 */
export function useSentinel(onVisible: () => void, enabled: boolean, watch: unknown, margin = 700) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    if (typeof IntersectionObserver === "undefined") { callback.current(); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) callback.current(); }, { rootMargin: `0px 0px ${margin}px 0px` });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, watch, margin]);
  return ref;
}
