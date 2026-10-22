/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { usePullToRefresh } from "./use-pull-to-refresh.ts";

function dispatchTouch(type: "touchstart" | "touchmove" | "touchend", clientY: number) {
  const touch = { clientY } as Touch;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [touch],
  });
  document.dispatchEvent(event);
}

describe("usePullToRefresh", () => {
  test("does nothing when disabled", () => {
    const onRefresh = vi.fn();
    const { result } = renderHook(() => usePullToRefresh({ enabled: false, onRefresh }));

    act(() => {
      dispatchTouch("touchstart", 10);
      dispatchTouch("touchmove", 120);
      dispatchTouch("touchend", 120);
    });

    expect(result.current.pullDistance).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test("calls onRefresh after a sufficient pull from the top", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh({ enabled: true, onRefresh }));

    await act(async () => {
      dispatchTouch("touchstart", 10);
      dispatchTouch("touchmove", 200);
      dispatchTouch("touchend", 200);
      await Promise.resolve();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.isRefreshing).toBe(false);
  });
});
