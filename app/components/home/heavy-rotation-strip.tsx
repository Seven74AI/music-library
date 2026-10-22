import { Link } from "react-router";
import { HomeRecentTrackCard } from "#app/components/home/home-recent-track-card.tsx";
import {
  type HeavyRotationTrack,
  type LibrarySortOption,
} from "#app/features/listening-insights/index.ts";
import { isPlayableTrack } from "#app/utils/playable-track.ts";

type HeavyRotationStripProps = {
  title: string;
  tracks: HeavyRotationTrack[];
  /** Mutually exclusive library sort linked from “View all”. */
  librarySort: Extract<LibrarySortOption, "mostPlayedMonth" | "mostPlayedEver">;
};

/**
 * Listening-hub Heavy Rotation strip (ADR-026).
 * Renders nothing when `tracks` is empty so the section is hidden.
 */
export function HeavyRotationStrip({ title, tracks, librarySort }: HeavyRotationStripProps) {
  if (tracks.length === 0) return null;

  const playableTracks = tracks.map((item) => item.track).filter(isPlayableTrack);

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <Link
          to={`/library?sort=${librarySort}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2 snap-x snap-mandatory">
        {tracks.map((item, index) => (
          <div key={item.track.id} className="snap-start">
            <HomeRecentTrackCard
              userTrack={{
                id: item.track.id,
                createdAt: new Date(0),
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
