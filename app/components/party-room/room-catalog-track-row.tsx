import { Link } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import {
  roomAlbumHref,
  roomArtistHref,
  type RoomCatalogTrack,
  type RoomSearchReturnState,
} from "#app/features/party-room/room-browse.ts";
import { formatDuration } from "#app/utils/format-duration.ts";
import { useRoomCatalogActions } from "./room-catalog-actions.tsx";

export function RoomCatalogTrackRow({
  track,
  showAlbum = true,
  returnState,
}: {
  track: RoomCatalogTrack;
  showAlbum?: boolean;
  returnState: RoomSearchReturnState;
}) {
  const { code, canAdd, addingTrackId, addToQueue, startAudition } = useRoomCatalogActions();
  const adding = addingTrackId === track.id;
  const albumHref = showAlbum && track.albumId ? roomAlbumHref(code, track.albumId) : null;
  const duration = track.duration == null ? null : formatDuration(track.duration);

  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {track.trackNumber != null ? (
            <span className="mr-2 text-muted-foreground tabular-nums">{track.trackNumber}</span>
          ) : null}
          {track.title}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          <Link
            to={roomArtistHref(code, track.artistId)}
            state={returnState}
            className="hover:text-foreground hover:underline"
          >
            {track.artistName}
          </Link>
          {albumHref && track.albumName ? (
            <>
              {" · "}
              <Link
                to={albumHref}
                state={returnState}
                className="hover:text-foreground hover:underline"
              >
                {track.albumName}
              </Link>
            </>
          ) : null}
          {duration ? ` · ${duration}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {canAdd ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void addToQueue(track)}
            disabled={adding}
            aria-label={adding ? `Adding ${track.title}` : `Add ${track.title} to the room queue`}
          >
            {adding ? "Adding…" : "Add"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void startAudition(track)}
          aria-label={`Audition ${track.title}`}
        >
          Audition
        </Button>
      </div>
    </li>
  );
}
