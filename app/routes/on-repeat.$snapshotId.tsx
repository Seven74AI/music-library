import { data } from "react-router";
import { useAudioPlayer } from "#app/components/audio-player-provider.tsx";
import { type BreadcrumbHandle } from "#app/components/breadcrumbs.tsx";
import { MusicEntityHeader } from "#app/components/music-entity-header.tsx";
import { PromoteSnapshotDialog } from "#app/components/promote-snapshot-dialog.tsx";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { formatYearMonthLabel } from "#app/features/on-repeat-snapshots/month.ts";
import { getOnRepeatSnapshotDetail } from "#app/features/on-repeat-snapshots/queries.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { getOnRepeatSnapshotTitle } from "#app/utils/breadcrumb-utils.ts";
import { filterPlayableTracks } from "#app/utils/playable-track.ts";
import {
  loadLibraryStatusByTrackId,
  loadUserPlaylists,
} from "#app/utils/track-list-loader.server.ts";
import { type Route } from "./+types/on-repeat.$snapshotId.ts";

export const handle: BreadcrumbHandle = {
  breadcrumb: ({ loaderData }) => getOnRepeatSnapshotTitle(loaderData),
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const snapshot = await getOnRepeatSnapshotDetail({
    userId,
    snapshotId: params.snapshotId,
  });

  if (!snapshot) {
    throw new Response("Snapshot not found", { status: 404 });
  }

  const trackIds = snapshot.tracks.map((row) => row.track.id);
  const [{ libraryTrackIds, userTrackCreatedAtByTrackId }, playlists] = await Promise.all([
    loadLibraryStatusByTrackId(userId, trackIds),
    loadUserPlaylists(userId),
  ]);

  const label = formatYearMonthLabel(snapshot.yearMonth);

  return data({
    snapshot: {
      id: snapshot.id,
      yearMonth: snapshot.yearMonth,
      generatedAt: snapshot.generatedAt,
      label,
      tracks: snapshot.tracks.map((row) => ({
        id: row.id,
        position: row.position,
        listenCount: row.listenCount,
        track: {
          id: row.track.id,
          title: row.track.title,
          duration: row.track.duration,
          serviceUrl: row.track.serviceUrl,
          createdAt: row.track.createdAt,
          artist: row.track.artist,
          coverImage: row.track.coverImage,
          service: row.track.service,
          audioFiles: row.track.audioFiles,
          isInUserLibrary: libraryTrackIds.has(row.track.id),
          userTrackCreatedAt:
            userTrackCreatedAtByTrackId.get(row.track.id)?.toISOString() ??
            row.track.createdAt.toISOString(),
        },
      })),
    },
    playlists,
  });
}

export default function OnRepeatSnapshotDetailPage({ loaderData }: Route.ComponentProps) {
  const { snapshot, playlists } = loaderData;
  const { playPlaylist, isLoadingNext } = useAudioPlayer();

  const playableTracks = filterPlayableTracks(snapshot.tracks.map((row) => row.track));

  const handlePlayAll = () => {
    if (playableTracks.length === 0) return;
    playPlaylist(playableTracks, {
      type: "onRepeatSnapshot",
      snapshotId: snapshot.id,
    });
  };

  return (
    <div className="py-6">
      <MusicEntityHeader
        label="On-Repeat Snapshot"
        title={snapshot.label}
        fallbackIcon="calendar"
        metadata={
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              {snapshot.tracks.length} track{snapshot.tracks.length !== 1 ? "s" : ""}
            </span>
            <span aria-hidden="true">·</span>
            <span>Read-only</span>
          </div>
        }
        description="Top finished plays for this calendar month (UTC). Promote to copy into an editable playlist."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Button onClick={handlePlayAll} disabled={playableTracks.length === 0 || isLoadingNext}>
          <Icon name="play" className="mr-2 h-4 w-4" />
          {isLoadingNext ? "Loading…" : "Play"}
        </Button>
        <PromoteSnapshotDialog snapshotId={snapshot.id} snapshotLabel={snapshot.label} />
      </div>

      {snapshot.tracks.length === 0 ? (
        <p className="text-muted-foreground">No tracks in this snapshot.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {snapshot.tracks.map((row, index) => (
            <li key={row.id} className="relative">
              <TrackListItem
                track={row.track}
                userTrack={{ createdAt: row.track.userTrackCreatedAt }}
                index={index}
                playlistContext={{
                  type: "onRepeatSnapshot",
                  snapshotId: snapshot.id,
                }}
                playlists={playlists}
                showDuration
                itemActionsContent={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {row.listenCount} listen{row.listenCount === 1 ? "" : "s"}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
