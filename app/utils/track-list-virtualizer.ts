import { measureElement as defaultMeasureElement, type Virtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useState, type RefObject } from "react";

/** Column header inside virtualized library and discover lists. */
export const TRACK_LIST_HEADER_HEIGHT_PX = 64;
/** Default `TrackListItem` row (`min-h-20`). */
export const TRACK_LIST_ROW_HEIGHT_PX = 80;

type TrackListVirtualizer = Virtualizer<Window, Element>;

export function estimateTrackListItemSize(index: number, hasHeader: boolean) {
  if (hasHeader && index === 0) return TRACK_LIST_HEADER_HEIGHT_PX;
  return TRACK_LIST_ROW_HEIGHT_PX;
}

/**
 * Prefer the laid-out height so a taller discover row cannot overlap the next one.
 * jsdom reports 0 before layout; fall back to the estimate so tests stay stable.
 */
export function measureTrackListElement(
  element: Element,
  entry: ResizeObserverEntry | undefined,
  instance: TrackListVirtualizer,
) {
  const measured = defaultMeasureElement(element, entry, instance);
  if (measured > 0) return measured;
  const index = instance.indexFromElement(element);
  if (index < 0) return TRACK_LIST_ROW_HEIGHT_PX;
  return instance.options.estimateSize(index);
}

export function virtualRowOffset(start: number, scrollMargin: number) {
  return `translateY(${start - scrollMargin}px)`;
}

/**
 * Distance from the document top to the list. Window virtualization adds this
 * to each item offset, then rows are placed relative to the list itself.
 */
export function useListScrollMargin(listRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = listRef.current;
    if (!element) return;

    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().top + window.scrollY);
      setScrollMargin((current) => (current === next ? current : next));
    };

    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (element.parentElement) observer?.observe(element.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled, listRef]);

  return scrollMargin;
}
