import { Link } from "react-router";
import { MarqueeText } from "#app/components/marquee-text";
import { type FullTrack } from "#app/types/frontend/shared";
import { cn } from "#app/utils/misc";

type Track = FullTrack;

/** Party-room speaker playback stubs this id when the snapshot has no artist id. */
export const ROOM_SPEAKER_ARTIST_ID = "room-artist";

export function artistPagePath(artistId: string): string | null {
  if (!artistId || artistId === ROOM_SPEAKER_ARTIST_ID) return null;
  return `/artists/${artistId}`;
}

export function PlayerTrackIdentity({
  track,
  titleClassName,
  artistClassName,
  className,
  onNavigate,
}: {
  track: Track;
  titleClassName: string;
  artistClassName: string;
  className?: string;
  onNavigate?: () => void;
}) {
  const artistHref = artistPagePath(track.artist.id);

  return (
    <div className={cn("min-w-0", className)}>
      <Link
        to={`/library/${track.id}`}
        prefetch="intent"
        onClick={onNavigate}
        className="block hover:underline focus-visible:underline"
      >
        <MarqueeText className={titleClassName}>{track.title}</MarqueeText>
      </Link>
      {artistHref ? (
        <Link
          to={artistHref}
          prefetch="intent"
          onClick={onNavigate}
          className="block hover:underline focus-visible:underline"
        >
          <MarqueeText className={artistClassName}>{track.artist.name}</MarqueeText>
        </Link>
      ) : (
        <MarqueeText className={artistClassName}>{track.artist.name}</MarqueeText>
      )}
    </div>
  );
}
