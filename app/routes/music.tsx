import { Outlet } from "react-router";
import { OfflineAwareErrorBoundary } from "#app/components/offline/offline-aware-error-boundary.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";

export default function MusicLayout() {
  return (
    <OfflineRouteBlocker>
      <main className="container flex min-h-[400px] flex-1 px-0 pb-12">
        <div className="w-full">
          <Outlet />
        </div>
      </main>
    </OfflineRouteBlocker>
  );
}

export function ErrorBoundary() {
  return <OfflineAwareErrorBoundary />;
}
