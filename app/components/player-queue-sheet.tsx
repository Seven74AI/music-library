import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAudioPlayer } from "#app/components/audio-player-provider";
import {
  formatQueueSheetTitle,
  getSpineSectionHeading,
  getSpineSectionLabel,
} from "#app/components/queue-sheet-ui";
import { TrackThumbnail } from "#app/components/track-thumbnail";
import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "#app/components/ui/sheet";
import { type FullTrack } from "#app/types/frontend/shared";

type Track = FullTrack;

const UP_NEXT_VIRTUAL_THRESHOLD = 20;
const SPINE_VIRTUAL_THRESHOLD = 20;

function QueueSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function measureScrollMargin(scrollElement: HTMLElement, listElement: HTMLElement): number {
  // Prefer offsetTop relative to the scrollport when it is the offsetParent
  // (queue-sheet-scroll is position:relative). This avoids stale getBoundingClientRect
  // reads against detached fallback list nodes after the virtualizer mounts.
  let offset = 0;
  let node: HTMLElement | null = listElement;
  while (node && node !== scrollElement) {
    offset += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent === scrollElement) {
      return offset;
    }
    if (!parent || !scrollElement.contains(parent)) {
      break;
    }
    node = parent;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const listRect = listElement.getBoundingClientRect();
  return listRect.top - scrollRect.top + scrollElement.scrollTop;
}

function VirtualQueueTrackList({
  tracks,
  onRemoveTrack,
  onPlayTrack,
  parentRef,
  hydrateTracksForDisplay,
}: {
  tracks: Track[];
  onRemoveTrack: (index: number) => void;
  onPlayTrack?: (index: number) => void;
  parentRef: React.RefObject<HTMLDivElement | null>;
  hydrateTracksForDisplay: (ids: string[]) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [scrollReadyEpoch, setScrollReadyEpoch] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  const setListRef = useCallback((node: HTMLDivElement | null) => {
    listRef.current = node;
    setListElement(node);
  }, []);

  useLayoutEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement || !listElement) return;

    let hasMeasured = scrollElement.clientHeight > 0;
    const syncMetrics = () => {
      // Always read the live list node — fallback → virtual swaps the DOM node.
      const liveList = listRef.current ?? listElement;
      setScrollMargin(measureScrollMargin(scrollElement, liveList));
      if (hasMeasured) return;
      if ((parentRef.current?.clientHeight ?? 0) <= 0) return;
      hasMeasured = true;
      setScrollReadyEpoch((epoch) => epoch + 1);
    };

    syncMetrics();
    const observer = new ResizeObserver(syncMetrics);
    observer.observe(scrollElement);
    observer.observe(listElement);
    scrollElement.addEventListener("scroll", syncMetrics, { passive: true });

    // Second rAF catches sibling virtualizers committing their total heights
    // after this list's first layout pass.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      syncMetrics();
      raf2 = requestAnimationFrame(syncMetrics);
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      observer.disconnect();
      scrollElement.removeEventListener("scroll", syncMetrics);
    };
  }, [parentRef, listElement, tracks.length]);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
    scrollMargin,
    rangeExtractor: defaultRangeExtractor,
  });
  void scrollReadyEpoch;

  const virtualItems = virtualizer.getVirtualItems();

  const visibleTrackKey = useMemo(() => {
    if (virtualItems.length > 0) {
      return virtualItems.map((item) => item.index).join(",");
    }
    return tracks
      .slice(0, 30)
      .map((_, index) => index)
      .join(",");
  }, [virtualItems, tracks]);

  useEffect(() => {
    const indices =
      visibleTrackKey.length > 0
        ? visibleTrackKey.split(",").map((index) => Number.parseInt(index, 10))
        : tracks.slice(0, 30).map((_, index) => index);

    const visibleTracks = indices
      .map((index) => tracks[index])
      .filter((track): track is Track => track !== undefined);

    hydrateTracksForDisplay(visibleTracks.map((track) => track.id));
  }, [visibleTrackKey, tracks, hydrateTracksForDisplay, scrollReadyEpoch]);

  if (virtualItems.length === 0 && tracks.length > 0) {
    return (
      <div ref={setListRef}>
        {tracks.slice(0, 30).map((track, index) => (
          <QueueTrackItem
            key={`${track.id}-${index}`}
            track={track}
            isCurrentlyPlaying={false}
            onRemove={() => onRemoveTrack(index)}
            onPlay={onPlayTrack ? () => onPlayTrack(index) : undefined}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={setListRef}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
      }}
    >
      {virtualItems.map((virtualItem) => {
        const track = tracks[virtualItem.index];
        if (!track) return null;

        return (
          <div
            key={`${track.id}-${virtualItem.index}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start - scrollMargin}px)`,
            }}
          >
            <QueueTrackItem
              track={track}
              isCurrentlyPlaying={false}
              onRemove={() => onRemoveTrack(virtualItem.index)}
              onPlay={onPlayTrack ? () => onPlayTrack(virtualItem.index) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

function QueueSheet({
  triggerClassName = "h-8 w-8 p-0",
  isPlaying,
  onTogglePlayPause,
}: {
  triggerClassName?: string;
  isPlaying?: boolean;
  onTogglePlayPause?: () => void;
}) {
  const {
    upNext,
    spine,
    spineTotal,
    spinePosition,
    currentTrack,
    playContext,
    removeTrackFromPlaylist,
    removeCurrentFromQueue,
    playQueueTrack,
    hydrateTracksForDisplay,
  } = useAudioPlayer();
  const queueScrollRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const currentTrackId = currentTrack?.id;

  const queueSheetTrackIds = useMemo(() => {
    const ids: string[] = [];
    if (currentTrackId) ids.push(currentTrackId);
    ids.push(...upNext.map((track) => track.id));
    if (spine.length < SPINE_VIRTUAL_THRESHOLD) {
      ids.push(...spine.map((track) => track.id));
    }
    return ids.join(",");
  }, [currentTrackId, upNext, spine]);

  useEffect(() => {
    if (!isOpen || queueSheetTrackIds.length === 0) return;
    hydrateTracksForDisplay(queueSheetTrackIds.split(","));
  }, [isOpen, queueSheetTrackIds, hydrateTracksForDisplay]);

  const spineLabel = getSpineSectionLabel(playContext);
  const sheetTitle = formatQueueSheetTitle(upNext.length, spineTotal, spineLabel);
  const spineHeading = getSpineSectionHeading(playContext);
  const isEmpty = !currentTrack && upNext.length === 0 && spine.length === 0 && spineTotal === 0;

  const removeUpNextTrack = useCallback(
    (index: number) => {
      removeTrackFromPlaylist({ zone: "upNext", index });
    },
    [removeTrackFromPlaylist],
  );

  const removeSpineTrack = useCallback(
    (displayIndex: number) => {
      removeTrackFromPlaylist({
        zone: "spine",
        index: spinePosition + 1 + displayIndex,
      });
    },
    [removeTrackFromPlaylist, spinePosition],
  );

  const playUpNextTrack = useCallback(
    (index: number) => {
      playQueueTrack({ zone: "upNext", index });
    },
    [playQueueTrack],
  );

  const playSpineTrack = useCallback(
    (displayIndex: number) => {
      playQueueTrack({ zone: "spine", index: spinePosition + 1 + displayIndex });
    },
    [playQueueTrack, spinePosition],
  );

  const removeCurrentTrack = useCallback(() => {
    removeCurrentFromQueue();
  }, [removeCurrentFromQueue]);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={triggerClassName}
          title="Queue"
          aria-label="Open queue"
        >
          <Icon name="list-bullet" className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[80vh] flex flex-col overflow-hidden p-2 sm:p-6">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle>{sheetTitle}</SheetTitle>
          <SheetDescription className="sr-only">
            Upcoming tracks grouped by now playing, up next, and library or playlist source
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 mt-6 min-h-0 flex flex-col gap-4">
          {isEmpty ? (
            <div className="text-center py-12">
              <Icon name="file-text" className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Queue is Empty</h3>
              <p className="text-muted-foreground">Add tracks to your queue to see them here.</p>
            </div>
          ) : (
            <>
              {currentTrack ? (
                <section className="flex-shrink-0">
                  <QueueSectionHeading>Now playing</QueueSectionHeading>
                  <QueueTrackItem
                    track={currentTrack}
                    isCurrentlyPlaying
                    isPlaying={isPlaying}
                    onRemove={removeCurrentTrack}
                    onTogglePlayPause={onTogglePlayPause}
                  />
                </section>
              ) : null}

              {upNext.length > 0 || spine.length > 0 || spineTotal > 0 ? (
                <div
                  ref={queueScrollRef}
                  data-testid="queue-sheet-scroll"
                  className="relative flex-1 min-h-0 overflow-y-auto"
                >
                  {upNext.length > 0 ? (
                    <section>
                      <QueueSectionHeading>Up Next</QueueSectionHeading>
                      {upNext.length >= UP_NEXT_VIRTUAL_THRESHOLD ? (
                        isOpen ? (
                          <VirtualQueueTrackList
                            tracks={upNext}
                            onRemoveTrack={removeUpNextTrack}
                            onPlayTrack={playUpNextTrack}
                            parentRef={queueScrollRef}
                            hydrateTracksForDisplay={hydrateTracksForDisplay}
                          />
                        ) : null
                      ) : (
                        upNext.map((track, index) => (
                          <QueueTrackItem
                            key={`${track.id}-${index}`}
                            track={track}
                            isCurrentlyPlaying={false}
                            onRemove={() => removeUpNextTrack(index)}
                            onPlay={() => playUpNextTrack(index)}
                          />
                        ))
                      )}
                    </section>
                  ) : null}

                  {spine.length > 0 || spineTotal > 0 ? (
                    <section>
                      <QueueSectionHeading>{spineHeading}</QueueSectionHeading>
                      {spine.length > 0 ? (
                        spine.length >= SPINE_VIRTUAL_THRESHOLD ? (
                          isOpen ? (
                            <VirtualQueueTrackList
                              tracks={spine}
                              onRemoveTrack={removeSpineTrack}
                              onPlayTrack={playSpineTrack}
                              parentRef={queueScrollRef}
                              hydrateTracksForDisplay={hydrateTracksForDisplay}
                            />
                          ) : null
                        ) : (
                          spine.map((track, index) => (
                            <QueueTrackItem
                              key={`${track.id}-${index}`}
                              track={track}
                              isCurrentlyPlaying={false}
                              onRemove={() => removeSpineTrack(index)}
                              onPlay={() => playSpineTrack(index)}
                            />
                          ))
                        )
                      ) : (
                        <p className="px-4 py-3 text-sm text-muted-foreground">
                          No more tracks in this queue.
                        </p>
                      )}
                    </section>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function QueueTrackItem({
  track,
  isCurrentlyPlaying,
  onRemove,
  onPlay,
  isPlaying,
  onTogglePlayPause,
}: {
  track: Track;
  isCurrentlyPlaying: boolean;
  onRemove: () => void;
  onPlay?: () => void;
  isPlaying?: boolean;
  onTogglePlayPause?: () => void;
}) {
  const coverImage = "coverImage" in track ? track.coverImage : null;

  const thumbnail = (
    <div className="flex-shrink-0 relative">
      <TrackThumbnail coverImage={coverImage} alt={track.title} size="md" />
      {isCurrentlyPlaying && (
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
          <Icon name="play" className="h-2 w-2 text-primary-foreground" />
        </div>
      )}
    </div>
  );

  const info = (
    <div className="flex-1 min-w-0">
      <div className="font-medium text-sm truncate">{track.title}</div>
      <div className="text-xs text-muted-foreground truncate">{track.artist.name}</div>
    </div>
  );

  return (
    <div
      className={`group flex items-center gap-3 px-4 py-3 rounded-md hover:bg-muted/50 transition-colors ${
        isCurrentlyPlaying ? "bg-primary/10 border-l-4 border-primary" : ""
      }`}
    >
      {onTogglePlayPause ? (
        <button
          type="button"
          onClick={onTogglePlayPause}
          className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
          aria-label={isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
        >
          {thumbnail}
          {info}
        </button>
      ) : onPlay ? (
        <button
          type="button"
          onClick={onPlay}
          className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
          aria-label={`Play ${track.title}`}
        >
          {thumbnail}
          {info}
        </button>
      ) : (
        <>
          {thumbnail}
          {info}
        </>
      )}

      <div className="flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onRemove}
          aria-label={`Remove ${track.title} from queue`}
        >
          <Icon name="trash" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export { QueueSheet };
