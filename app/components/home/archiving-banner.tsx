import { Link } from "react-router";
import { Icon } from "#app/components/ui/icon.tsx";

type ArchivingBannerProps = {
  totalTracks: number;
  playableTracks: number;
  archivingCount: number;
};

export function ArchivingBanner({
  totalTracks,
  playableTracks,
  archivingCount,
}: ArchivingBannerProps) {
  return (
    <div
      className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex items-start gap-3">
        <Icon name="clock" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="font-medium">Your music is being prepared</p>
          <p className="text-sm text-muted-foreground">
            {totalTracks} {totalTracks === 1 ? "track" : "tracks"} in your library ·{" "}
            {playableTracks} ready to play · {archivingCount} archiving
          </p>
        </div>
      </div>
      <Link
        to="/library"
        className="text-sm font-medium text-amber-700 underline hover:no-underline dark:text-amber-300"
      >
        View library
      </Link>
    </div>
  );
}
