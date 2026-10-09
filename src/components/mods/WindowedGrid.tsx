import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

/** Items per chunk: divisible by 1, 2, 3, 4 and 6 columns, so every chunk but the last ends on a full row. */
export const CHUNK = 24;

type Props<T> = { items: readonly T[]; keyOf: (item: T) => string; render: (item: T) => ReactNode; className: string; chunk?: number };

/**
 * A long grid rendered in chunks. A chunk far outside the viewport is replaced by an empty box of its last measured height,
 * so a list of hundreds of cards keeps only a few dozen in the DOM while scrolling stays smooth. Each chunk is its own grid
 * (`className`), stacked by `.windowed-grid`.
 */
export function WindowedGrid<T>({ items, keyOf, render, className, chunk = CHUNK }: Props<T>) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunk) chunks.push(items.slice(index, index + chunk));
  return <div className="windowed-grid">
    {chunks.map((part, index) => <Chunk key={index} className={className} eager={index < 2}>{part.map((item) => <Fragment key={keyOf(item)}>{render(item)}</Fragment>)}</Chunk>)}
  </div>;
}

function Chunk({ className, eager, children }: { className: string; eager: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const height = useRef(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      // Measure before hiding so the placeholder keeps the scroll position exact.
      if (!entry.isIntersecting && node.offsetHeight) height.current = node.offsetHeight;
      // Keep the chunk that holds keyboard focus, so Tab never jumps out of the list.
      setVisible(entry.isIntersecting || node.contains(document.activeElement));
    }, { rootMargin: "1200px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const show = visible || eager;
  return <div ref={ref} className={`${className} windowed-chunk`} style={show ? undefined : { height: height.current || undefined, minHeight: height.current ? undefined : 600 }} aria-hidden={show ? undefined : true}>{show ? children : null}</div>;
}
