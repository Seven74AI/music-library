import { Link } from "react-router";
import { PlaylistCover } from "#app/components/playlist-cover.tsx";
import { formatYearMonthLabel } from "#app/features/on-repeat-snapshots/month.ts";
import { listOnRepeatSnapshotHistory } from "#app/features/on-repeat-snapshots/queries.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { type Route } from "./+types/on-repeat.index.ts";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const { items, nextCursor } = await listOnRepeatSnapshotHistory({ userId, cursor });
  return { items, nextCursor };
}

export default function OnRepeatHistoryPage({ loaderData }: Route.ComponentProps) {
  const { items, nextCursor } = loaderData;

  return (
    <div className="py-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">On-Repeat Snapshots</h1>
        <p className="mt-2 text-muted-foreground">
          Frozen monthly playlists of tracks you finished. Generated on the 1st of each month.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border py-12 text-center text-muted-foreground">
          <p>No snapshots yet.</p>
          <p className="mt-1 text-sm">
            Finish some tracks this month — a snapshot will appear on the 1st.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((snapshot) => (
            <li key={snapshot.id}>
              <Link
                to={`/on-repeat/${snapshot.id}`}
                className="flex gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/40"
              >
                <PlaylistCover tracks={snapshot.previewTracks} size="md" />
                <div className="min-w-0 self-center">
                  <p className="truncate font-semibold">
                    {formatYearMonthLabel(snapshot.yearMonth)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {snapshot.trackCount} track{snapshot.trackCount === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className="mt-8 text-center">
          <Link
            to={`/on-repeat?cursor=${encodeURIComponent(nextCursor)}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Older snapshots
          </Link>
        </div>
      ) : null}
    </div>
  );
}
