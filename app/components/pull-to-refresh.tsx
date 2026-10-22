import { useCallback, useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { Icon } from "#app/components/ui/icon.tsx";
import { isStandaloneDisplayMode } from "#app/utils/pwa-install.client.ts";
import { useIsMobile } from "#app/utils/use-mobile.ts";
import { usePullToRefresh } from "#app/utils/use-pull-to-refresh.ts";

/**
 * Enables pull-to-refresh in the installed PWA (standalone) on mobile.
 * Calls React Router revalidation so loaders refresh.
 */
export function PullToRefreshProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const revalidator = useRevalidator();
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(isStandaloneDisplayMode());
  }, []);

  const onRefresh = useCallback(async () => {
    revalidator.revalidate();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, [revalidator]);

  const enabled = isMobile && standalone;
  const { pullDistance, isRefreshing, progress } = usePullToRefresh({
    enabled,
    onRefresh,
  });

  return (
    <div className="relative">
      {enabled && (pullDistance > 0 || isRefreshing) ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center"
          style={{ height: Math.max(pullDistance, isRefreshing ? 40 : 0) }}
          aria-live="polite"
          aria-busy={isRefreshing}
        >
          <div className="mt-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow-sm">
            <Icon
              name="update"
              className={`h-4 w-4 text-muted-foreground ${isRefreshing || progress >= 1 ? "animate-spin" : ""}`}
              style={
                !isRefreshing && progress < 1
                  ? { transform: `rotate(${progress * 180}deg)` }
                  : undefined
              }
            />
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}
