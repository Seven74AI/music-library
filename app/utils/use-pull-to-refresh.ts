import { useCallback, useEffect, useRef, useState } from "react";

const PULL_THRESHOLD_PX = 72;
const MAX_PULL_PX = 96;

type UsePullToRefreshOptions = {
  enabled: boolean;
  onRefresh: () => void | Promise<void>;
  /** Element that owns vertical scroll; defaults to window */
  getScrollParent?: () => HTMLElement | null;
};

export function usePullToRefresh({ enabled, onRefresh, getScrollParent }: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const getScrollTop = useCallback(() => {
    const parent = getScrollParent?.();
    if (parent) return parent.scrollTop;
    return window.scrollY || document.documentElement.scrollTop || 0;
  }, [getScrollParent]);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (event: TouchEvent) => {
      if (isRefreshingRef.current) return;
      if (getScrollTop() > 0) {
        startYRef.current = null;
        return;
      }
      startYRef.current = event.touches[0]?.clientY ?? null;
      pullingRef.current = false;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startYRef.current == null || isRefreshingRef.current) return;
      const currentY = event.touches[0]?.clientY ?? startYRef.current;
      const delta = currentY - startYRef.current;
      if (delta <= 0 || getScrollTop() > 0) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        pullingRef.current = false;
        return;
      }
      pullingRef.current = true;
      const resisted = Math.min(MAX_PULL_PX, delta * 0.45);
      pullDistanceRef.current = resisted;
      setPullDistance(resisted);
      if (resisted > 8) {
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) {
        startYRef.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      const shouldRefresh = pullDistanceRef.current >= PULL_THRESHOLD_PX * 0.45;
      startYRef.current = null;
      pullingRef.current = false;

      if (!shouldRefresh) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      isRefreshingRef.current = true;
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD_PX * 0.45);
      void Promise.resolve(onRefreshRef.current())
        .catch(() => {})
        .finally(() => {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
          pullDistanceRef.current = 0;
          setPullDistance(0);
        });
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, getScrollTop]);

  return {
    pullDistance,
    isRefreshing,
    isPulling: pullDistance > 0,
    progress: Math.min(1, pullDistance / (PULL_THRESHOLD_PX * 0.45)),
  };
}
