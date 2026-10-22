/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { InfiniteScrollSentinel } from "./infinite-scroll-sentinel";

type Entry = { isIntersecting: boolean };
type ObserverCallback = (entries: Entry[], observer: unknown) => void;

let observers: Array<{
  callback: ObserverCallback;
  element: Element | null;
  rootMargin: string;
  threshold: number | number[];
}> = [];

class MockIntersectionObserver {
  callback: ObserverCallback;
  rootMargin: string;
  threshold: number | number[];
  element: Element | null = null;

  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? "0px";
    this.threshold = options?.threshold ?? 0;
    observers.push(this);
  }

  observe(element: Element) {
    this.element = element;
  }

  unobserve() {}

  disconnect() {}
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

test("fires onIntersect when the sentinel scrolls into view", () => {
  const onIntersect = vi.fn();
  render(
    <InfiniteScrollSentinel onIntersect={onIntersect}>
      <span>Load more</span>
    </InfiniteScrollSentinel>,
  );

  expect(observers).toHaveLength(1);
  expect(observers[0]!.element).not.toBeNull();
  expect(observers[0]!.rootMargin).toBe("200px");

  observers[0]!.callback([{ isIntersecting: true }], observers[0]!);
  expect(onIntersect).toHaveBeenCalledTimes(1);
});

test("does not fire when the sentinel is not intersecting", () => {
  const onIntersect = vi.fn();
  render(<InfiniteScrollSentinel onIntersect={onIntersect} />);

  observers[0]!.callback([{ isIntersecting: false }], observers[0]!);
  expect(onIntersect).not.toHaveBeenCalled();
});

test("does not observe when disabled", () => {
  const onIntersect = vi.fn();
  render(
    <InfiniteScrollSentinel onIntersect={onIntersect} enabled={false}>
      <span>Loading…</span>
    </InfiniteScrollSentinel>,
  );

  expect(observers).toHaveLength(0);
  expect(screen.getByText("Loading…")).toBeTruthy();
});

test("re-observes when re-enabled", () => {
  const onIntersect = vi.fn();
  const { rerender } = render(<InfiniteScrollSentinel onIntersect={onIntersect} enabled={false} />);

  expect(observers).toHaveLength(0);

  rerender(<InfiniteScrollSentinel onIntersect={onIntersect} enabled={true} />);

  expect(observers).toHaveLength(1);
  observers[0]!.callback([{ isIntersecting: true }], observers[0]!);
  expect(onIntersect).toHaveBeenCalledTimes(1);
});
