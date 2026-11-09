/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./use-mobile.ts";

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    media: "(max-width: 767px)",
    addEventListener: (_: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: () => void) => {
      listeners.delete(listener);
    },
    dispatchChange(next: boolean) {
      (mql as { matches: boolean }).matches = next;
      listeners.forEach((l) => l());
    },
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(max-width: 767px)");
    return mql;
  });
  return mql;
}

describe("useIsMobile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false at 768px and true below md", () => {
    const mql = stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      mql.dispatchChange(true);
    });
    expect(result.current).toBe(true);
  });
});
