import { HomeRecentTrackCard } from "#app/components/home/home-recent-track-card.tsx";
import { type HomeRecentTrack } from "#app/utils/home.server.ts";
import { isPlayableTrack } from "#app/utils/playable-track.ts";

type HomeRecentTrackRowProps = {
  recentTracks: HomeRecentTrack[];
};

export function HomeRecentTrackRow({ recentTracks }: HomeRecentTrackRowProps) {
  if (recentTracks.length === 0) {
    return <p className="text-muted-foreground py-4 text-center text-sm">No tracks yet</p>;
  }

  const playableTracks = recentTracks.map((userTrack) => userTrack.track).filter(isPlayableTrack);

  return (
    <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
      {recentTracks.map((userTrack, index) => (
        <div key={userTrack.id} className="snap-start">
          <HomeRecentTrackCard
            userTrack={userTrack}
            index={index}
            playableTracks={playableTracks}
          />
        </div>
      ))}
    </div>
  );
}
