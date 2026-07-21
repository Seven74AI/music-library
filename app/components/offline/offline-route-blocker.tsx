import { OfflineUnavailableView } from "#app/components/offline/offline-unavailable-view.tsx";
import { useOnlineStatus } from "#app/hooks/use-online-status.ts";

type OfflineRouteBlockerProps = {
  children: React.ReactNode;
};

export function OfflineRouteBlocker({ children }: OfflineRouteBlockerProps) {
  const isOnline = useOnlineStatus();

  if (isOnline) return children;

  return (
    <main className="py-12">
      <OfflineUnavailableView />
    </main>
  );
}
