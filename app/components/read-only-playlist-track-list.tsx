import { useAudioPlayer } from "#app/components/audio-player-provider.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { type FullTrack } from "#app/types/frontend/shared.ts";
import { formatDuration } from "#app/utils/format-duration.ts";

export type ReadOnlyPlaylistTrack = {
  id: string;
  title: string;
  artist: { id: string; name: string };
  duration: number | null;
  coverImage: { objectKey: string } | null;
  // The viewer payload deliberately omits `objectKey` (no S3 keys for visitors).
  audioFiles: Array<{ id: string; format: string | null }>;
};

type ReadOnlyPlaylistTrackListProps = {
  playlistId: string;
  tracks: Array<{ id: string; track: ReadOnlyPlaylistTrack }>;
  /** Play affordances render for logged-in viewers only. */
  canPlay: boolean;
};

/**
 * Read-only track list for a shared (PUBLIC/UNLISTED) playlist viewed by a
 * non-owner. Intentionally NOT `SortableTrackList`/`TrackListItem`: those carry
 * add-to-playlist, add-to-library, per-track download, remove, reorder and
 * selection/bulk affordances a viewer must never see (ADR-045). Playback goes
 * through the queue spine, which resolves the tracks server-side by id.
 */
export function ReadOnlyPlaylistTrackList({
  playlistId,
  tracks,
  canPlay,
}: ReadOnlyPlaylistTrackListProps) {
  const { currentTrack, isPlaying, playTrack, pauseTrack, resumeTrack } = useAudioPlayer();

  return (
    <ol className="divide-y rounded-lg border" aria-label="Playlist tracks">
      {tracks.map(({ id, track }, index) => {
        const playable = canPlay && track.audioFiles.length > 0;
        const isCurrent = currentTrack?.id === track.id;
        const showPause = isCurrent && isPlaying;
        return (
          <li key={id} className="flex items-center gap-3 p-3" data-testid="read-only-track-row">
            <span className="text-muted-foreground w-6 text-right text-sm">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{track.title}</p>
              <p className="text-muted-foreground truncate text-sm">{track.artist.name}</p>
            </div>
            <span className="text-muted-foreground text-sm">{formatDuration(track.duration)}</span>
            {playable ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={showPause ? `Pause ${track.title}` : `Play ${track.title}`}
                onClick={() => {
                  if (showPause) return pauseTrack();
                  if (isCurrent) return resumeTrack();
                  // playTrack only needs a non-empty audioFiles list to treat the
                  // track as playable; the stream route authorises by track id.
                  const playableTrack: FullTrack = {
                    ...track,
                    audioFiles: track.audioFiles.map((file) => ({
                      ...file,
                      objectKey: "",
                    })),
                  };
                  void playTrack(
                    playableTrack,
                    {
                      type: "playlist",
                      playlistId,
                      sort: "custom",
                      sortDirection: "asc",
                    },
                    index,
                  );
                }}
              >
                <Icon name={showPause ? "pause" : "play"} className="h-4 w-4" />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
