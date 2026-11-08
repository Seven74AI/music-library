import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_THRESHOLD = 49;

interface TouchState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface UseSwipeGestureOptions {
  /** Horizontal pixel distance required to trigger a swipe (default: 49) */
  threshold?: number;
  /** Called when user swipes left (drag left → skip next) */
  onSwipeLeft?: () => void;
  /** Called when user swipes right (drag right → skip previous) */
  onSwipeRight?: () => void;
  /** When false, touch events are ignored (default: true) */
  enabled?: boolean;
}

export interface UseSwipeGestureResult {
  /** Current horizontal offset from touch origin, in pixels (0 = neutral) */
  offsetX: number;
  /** Whether a touch gesture is currently in progress */
  isSwiping: boolean;
}

/**
 * Tracks horizontal touch gestures on an element and exposes the current
 * offset for drag-to-reveal visual feedback.
 *
 * Provides a clean test seam — unit tests cover the touch event logic,
 * integration tests can mock the hook to simulate swipes.
 */
export function useSwipeGesture(
  ref: React.RefObject<HTMLElement | null>,
  options: UseSwipeGestureOptions = {},
): UseSwipeGestureResult {
  const { threshold = DEFAULT_THRESHOLD, onSwipeLeft, onSwipeRight, enabled = true } = options;

  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStateRef = useRef<TouchState | null>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled || e.touches.length !== 1) return;
      const touch = e.touches[0]!;
      touchStateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
      };
    },
    [enabled],
  );

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchStateRef.current || e.touches.length !== 1) return;
    const state = touchStateRef.current;
    const touch = e.touches[0]!;
    state.currentX = touch.clientX;
    state.currentY = touch.clientY;
    const deltaX = state.currentX - state.startX;
    setOffsetX(deltaX);
    setIsSwiping(true);
  }, []);

  const resetTouch = useCallback(() => {
    setOffsetX(0);
    setIsSwiping(false);
    touchStateRef.current = null;
  }, []);

  const handleTouchEnd = useCallback(() => {
    const state = touchStateRef.current;
    if (!state) return;

    const deltaX = state.currentX - state.startX;
    const deltaY = state.currentY - state.startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    if (absDeltaX >= threshold && absDeltaX > absDeltaY) {
      if (deltaX < 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    }

    resetTouch();
  }, [threshold, onSwipeLeft, onSwipeRight, resetTouch]);

  const handleTouchCancel = useCallback(() => {
    resetTouch();
  }, [resetTouch]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd);
    el.addEventListener("touchcancel", handleTouchCancel);

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [ref, handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  return { offsetX, isSwiping };
}
