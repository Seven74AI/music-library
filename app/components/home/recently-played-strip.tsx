import { Link } from "react-router";
import { HomeRecentTrackCard } from "#app/components/home/home-recent-track-card.tsx";
import { type RecentlyPlayedTrack } from "#app/features/recently-played/recently-played.server.ts";
import { isPlayableTrack } from "#app/utils/playable-track.ts";

type RecentlyPlayedStripProps = {
  tracks: RecentlyPlayedTrack[];
};

/**
 * Listening-hub strip of distinct recently finished tracks (ADR-025).
 * Hidden when empty so the home page does not show a blank section.
 */
export function RecentlyPlayedStrip({ tracks }: RecentlyPlayedStripProps) {
  if (tracks.length === 0) return null;

  const playableTracks = tracks.map((item) => item.track).filter(isPlayableTrack);

  return (
    <section className="mb-10" aria-labelledby="recently-played-heading">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="recently-played-heading" className="text-xl font-semibold">
          Recently played
        </h2>
        <Link to="/history" className="text-sm text-muted-foreground hover:underline">
          View history
        </Link>
      </div>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
        {tracks.map((item, index) => (
          <div key={item.track.id} className="snap-start">
            <HomeRecentTrackCard
              userTrack={{
                id: item.track.id,
                createdAt: item.playedAt,
                track: item.track,
              }}
              index={index}
              playableTracks={playableTracks}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
