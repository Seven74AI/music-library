import { useEffect, useRef, type ReactNode } from "react";

export interface InfiniteScrollSentinelProps {
  /** Called whenever the sentinel scrolls into the viewport. */
  onIntersect: () => void;
  /**
   * When false the observer is disconnected (e.g. no next page, or a page is
   * already loading). Defaults to true.
   */
  enabled?: boolean;
  /** `rootMargin` passed to IntersectionObserver. Defaults to "200px". */
  rootMargin?: string;
  /** `threshold` passed to IntersectionObserver. Defaults to 0. */
  threshold?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * Thin IntersectionObserver wrapper used for infinite scroll. Renders a single
 * element (with optional children, e.g. a spinner) and calls `onIntersect`
 * whenever that element enters the viewport.
 *
 * The callback is held in a ref so the observer is only rebuilt when `enabled`,
 * `rootMargin`, or `threshold` change — not on every render.
 */
export function InfiniteScrollSentinel({
  onIntersect,
  enabled = true,
  rootMargin = "200px",
  threshold = 0,
  className,
  children,
}: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onIntersectRef = useRef(onIntersect);
  onIntersectRef.current = onIntersect;

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onIntersectRef.current();
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, rootMargin, threshold]);

  return (
    <div ref={sentinelRef} className={className} data-testid="infinite-scroll-sentinel">
      {children}
    </div>
  );
}
