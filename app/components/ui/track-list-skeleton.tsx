import { Skeleton } from "./skeleton";

const SKELETON_KEYS = ["s0", "s1", "s2", "s3", "s4"] as const;

export function TrackListSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading tracks">
      {SKELETON_KEYS.map((key) => (
        <div key={key} className="flex items-center space-x-4 p-4 border rounded-lg">
          <Skeleton className="h-10 w-10 rounded" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-3 w-[200px]" />
          </div>
          <Skeleton className="h-4 w-16" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
