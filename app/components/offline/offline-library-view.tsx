import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { Link } from "react-router";
import { toOfflineTrackListItemTrack } from "#app/components/offline/to-offline-track-list-item-track.ts";
import { TrackListItem } from "#app/components/track-list-item.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { type OfflineTrackSummary } from "#app/features/offline-storage/types.ts";
import {
  estimateTrackListItemSize,
  measureTrackListElement,
  useListScrollMargin,
  virtualRowOffset,
} from "#app/utils/track-list-virtualizer.ts";

type OfflineLibraryViewProps = {
  tracks: OfflineTrackSummary[];
};

function OfflineLibraryTrackItem({ track, index }: { track: OfflineTrackSummary; index: number }) {
  const trackData = toOfflineTrackListItemTrack(track);

  return (
    <TrackListItem
      track={trackData}
      userTrack={{ createdAt: new Date(track.lastAccessedAt) }}
      index={index}
      playlistContext={{ type: "library" }}
      offlineDownloadTrack={trackData}
    />
  );
}

export function OfflineLibraryView({ tracks }: OfflineLibraryViewProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useListScrollMargin(listRef, tracks.length > 0);

  const virtualizer = useWindowVirtualizer({
    count: tracks.length,
    estimateSize: (index) => estimateTrackListItemSize(index, false),
    measureElement: measureTrackListElement,
    overscan: 5,
    scrollMargin,
  });

  if (tracks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="text-muted-foreground">
          No downloaded tracks available offline. Download music while you still have a connection.
        </p>
        <Button asChild className="mt-4">
          <Link to="/downloads">Open downloads</Link>
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="list"
      aria-label="Downloaded tracks"
      className="relative min-w-0 rounded-lg border"
    >
      <div
        role="presentation"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const track = tracks[virtualItem.index];
          if (!track) return null;

          return (
            <div
              key={track.trackId}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              role="presentation"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: virtualRowOffset(virtualItem.start, scrollMargin),
              }}
              className="border-b last:border-b-0"
            >
              <OfflineLibraryTrackItem track={track} index={virtualItem.index} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
