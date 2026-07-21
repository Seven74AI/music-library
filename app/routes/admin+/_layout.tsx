import { Outlet } from "react-router";
import { OfflineAwareErrorBoundary } from "#app/components/offline/offline-aware-error-boundary.tsx";
import { OfflineRouteBlocker } from "#app/components/offline/offline-route-blocker.tsx";

export default function AdminLayout() {
  return (
    <OfflineRouteBlocker>
      <Outlet />
    </OfflineRouteBlocker>
  );
}

export function ErrorBoundary() {
  return <OfflineAwareErrorBoundary />;
}
