import { Button } from "./ui/button.tsx";
import { Icon } from "./ui/icon.tsx";

export interface LockBannerProps {
  lockedByName: string;
  entityType?: "track" | "artist" | "album";
  onRefresh?: () => void;
  className?: string;
}

export function LockBanner({
  lockedByName,
  entityType: _entityType = "track",
  onRefresh,
  className = "",
}: LockBannerProps) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border border-yellow-600 bg-yellow-50 p-4 dark:bg-yellow-950 ${className}`}
    >
      <div className="flex items-center gap-3">
        <Icon name="lock-closed" className="size-5 text-yellow-600" />
        <div>
          <p className="font-medium text-yellow-900 dark:text-yellow-100">Currently being edited</p>
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            <span className="font-semibold">{lockedByName}</span> is currently editing this. You can
            view the content but cannot make changes.
          </p>
        </div>
      </div>
      {onRefresh && (
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <Icon name="arrow-path" className="mr-2 size-4" />
          Refresh
        </Button>
      )}
    </div>
  );
}
