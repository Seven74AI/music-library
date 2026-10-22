import { Link } from "react-router";
import { PlaylistCover } from "#app/components/playlist-cover.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { type OnRepeatSnapshotSummary } from "#app/features/on-repeat-snapshots/queries.server.ts";
import { formatYearMonthLabel } from "#app/features/on-repeat-snapshots/month.ts";

type SnapshotShelfProps = {
  snapshots: OnRepeatSnapshotSummary[];
  /** When true, render nothing if the shelf is empty (home hub). */
  hideWhenEmpty?: boolean;
};

/**
 * Snapshot Shelf — latest On-Repeat Snapshots plus a link to full history.
 * Standalone so listening-hub siblings can compose beside it without layout thrash.
 */
export function SnapshotShelf({ snapshots, hideWhenEmpty = false }: SnapshotShelfProps) {
  if (snapshots.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <section aria-labelledby="snapshot-shelf-heading">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="snapshot-shelf-heading" className="text-xl font-semibold">
            On-Repeat
          </h2>
          <Link to="/on-repeat" className="text-sm text-muted-foreground hover:underline">
            View all
          </Link>
        </div>
        <div className="text-muted-foreground rounded-lg border py-8 text-center">
          <p>No monthly snapshots yet</p>
          <p className="mt-1 text-sm">
            Snapshots appear on the 1st of each month from tracks you finish.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="snapshot-shelf-heading" className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="snapshot-shelf-heading" className="text-xl font-semibold">
          On-Repeat
        </h2>
        <Link to="/on-repeat" className="text-sm text-muted-foreground hover:underline">
          View all
        </Link>
      </div>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
        {snapshots.map((snapshot) => (
          <Link
            key={snapshot.id}
            to={`/on-repeat/${snapshot.id}`}
            className="w-56 shrink-0 snap-start rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40 sm:w-64"
          >
            <PlaylistCover tracks={snapshot.previewTracks} size="lg" className="mb-3" />
            <div className="min-w-0">
              <p className="truncate font-medium">{formatYearMonthLabel(snapshot.yearMonth)}</p>
              <p className="text-sm text-muted-foreground">
                {snapshot.trackCount} track{snapshot.trackCount === 1 ? "" : "s"}
              </p>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/on-repeat">All snapshots</Link>
        </Button>
      </div>
    </section>
  );
}
