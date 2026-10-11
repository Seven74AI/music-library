import { useInfiniteQuery } from "@tanstack/react-query";
import { useWindowVirtualizer, defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef } from "react";
import { data, useSearchParams } from "react-router";
import { SortDirectionToggle } from "#app/components/sort-direction-toggle.tsx";
import { TrackListItem } from "#app/components/track-list-item";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { TrackListSkeleton } from "#app/components/ui/track-list-skeleton";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  DISCOVER_TRACKS_PAGE_SIZE,
  parseDiscoverSort,
  defaultDiscoverSortDirection,
  type DiscoverSortOption,
  type DiscoverTrack,
} from "#app/utils/discover.ts";
import { listDiscoverTracks } from "#app/utils/discover-tracks.server.ts";
import { parseSortDirection, type SortDirection } from "#app/utils/sort-direction.ts";
import {
  estimateTrackListItemSize,
  measureTrackListElement,
  useListScrollMargin,
  virtualRowOffset,
} from "#app/utils/track-list-virtualizer.ts";
import { type Route } from "./+types/discover.index.ts";

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || String(DISCOVER_TRACKS_PAGE_SIZE))),
  );
  const sort = parseDiscoverSort(url.searchParams.get("sort"));
  const direction = parseSortDirection(
    url.searchParams.get("dir"),
    defaultDiscoverSortDirection(sort),
  );

  const { tracks, pagination } = await listDiscoverTracks({
    userId,
    sort,
    direction,
    cursor,
    limit,
  });

  const playlists = await prisma.userPlaylist.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      title: true,
      description: true,
      _count: {
        select: { tracks: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return data({
    tracks,
    pagination,
    sort,
    direction,
    playlists,
  });
}

type DiscoverTrackListItemProps = {
  track: DiscoverTrack;
  index: number;
  sort: DiscoverSortOption;
  direction: SortDirection;
  playlists: Array<{
    id: string;
    title: string;
    description: string | null;
    _count: { tracks: number };
  }>;
};

function DiscoverTrackListItem({
  track,
  index,
  sort,
  direction,
  playlists,
}: DiscoverTrackListItemProps) {
  return (
    <TrackListItem
      track={{
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.albumRecord,
        duration: track.duration,
        coverImage: track.coverImage,
        serviceUrl: track.serviceUrl,
        service: track.service,
        audioFiles: track.audioFiles,
        isInUserLibrary: track.isInUserLibrary,
        releaseDate: track.releaseDate,
        originalDate: track.originalDate,
        createdAt: track.createdAt,
        popularityStats: track.popularityStats,
      }}
      userTrack={{ createdAt: track.userTrackCreatedAt ?? track.createdAt }}
      index={index}
      playlists={playlists}
      playlistContext={{ type: "discover", discoverSort: sort, sortDirection: direction }}
      showQuickAddToPlaylist
      showAddToLibrary
      showAudioFileDownload={track.isInUserLibrary}
      usePlaybackIndex={false}
    />
  );
}

export default function DiscoverIndexRoute({ loaderData }: Route.ComponentProps) {
  const {
    tracks,
    pagination,
    sort: loaderSort,
    direction: loaderDirection,
    playlists,
  } = loaderData;

  const pageSize = pagination.limit ?? DISCOVER_TRACKS_PAGE_SIZE;
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = parseDiscoverSort(searchParams.get("sort") ?? loaderSort);
  const direction = parseSortDirection(
    searchParams.get("dir") ?? loaderDirection,
    defaultDiscoverSortDirection(sort),
  );
  const listRef = useRef<HTMLDivElement>(null);

  const scrollDiscoverToTop = useCallback(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const handleSortChange = useCallback(
    (value: string) => {
      const nextSort = parseDiscoverSort(value);
      const nextParams = new URLSearchParams(searchParams);
      if (nextSort === "recentlyAdded") {
        nextParams.delete("sort");
      } else {
        nextParams.set("sort", nextSort);
      }
      nextParams.delete("dir");
      setSearchParams(nextParams, { preventScrollReset: true });
      scrollDiscoverToTop();
    },
    [searchParams, setSearchParams, scrollDiscoverToTop],
  );

  const handleDirectionChange = useCallback(
    (next: SortDirection) => {
      const nextParams = new URLSearchParams(searchParams);
      if (next === defaultDiscoverSortDirection(sort)) {
        nextParams.delete("dir");
      } else {
        nextParams.set("dir", next);
      }
      setSearchParams(nextParams, { preventScrollReset: true });
      scrollDiscoverToTop();
    },
    [searchParams, setSearchParams, scrollDiscoverToTop, sort],
  );

  const {
    data: queryData,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isPending,
    status,
  } = useInfiniteQuery({
    queryKey: ["discover-tracks", { pageSize, sort, direction }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      if (pageParam) {
        params.set("cursor", String(pageParam));
      }
      if (sort !== "recentlyAdded") {
        params.set("sort", sort);
      }
      if (direction !== defaultDiscoverSortDirection(sort)) {
        params.set("dir", direction);
      }
      const res = await fetch(`/api/discover-tracks?${params}`);
      const json = (await res.json()) as {
        tracks: DiscoverTrack[];
        pagination: { hasNext: boolean; nextCursor: string | null };
      };
      return json;
    },
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor || undefined,
    initialPageParam: undefined as string | undefined,
    initialData:
      sort === loaderSort && direction === loaderDirection
        ? {
            pages: [
              {
                tracks: tracks || [],
                pagination: {
                  hasNext: pagination?.hasNext || false,
                  nextCursor: pagination?.nextCursor || null,
                },
              },
            ],
            pageParams: [undefined],
          }
        : undefined,
  });

  const allItems = queryData?.pages.flatMap((page) => page.tracks) || [];

  const listReady = status === "success" && allItems.length > 0;
  const scrollMargin = useListScrollMargin(listRef, listReady);
  const virtualizer = useWindowVirtualizer({
    count: 1 + allItems.length + (hasNextPage ? 1 : 0),
    estimateSize: (index) => estimateTrackListItemSize(index, true),
    measureElement: measureTrackListElement,
    overscan: 5,
    scrollMargin,
    rangeExtractor: useCallback((range: Range) => {
      const next = new Set([0, ...defaultRangeExtractor(range)]);
      return [...next].sort((a, b) => a - b);
    }, []),
  });

  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const [lastItem] = [...virtualItems].reverse();

    if (!lastItem) return;

    if (lastItem.index >= allItems.length && hasNextPage && !isFetchingNextPage) {
      void (async () => {
        try {
          await fetchNextPage();
        } catch (fetchError) {
          console.error("Failed to fetch next page:", fetchError);
        }
      })();
    }
  }, [hasNextPage, fetchNextPage, isFetchingNextPage, virtualItems, allItems.length]);

  if (isPending) {
    return (
      <div className="space-y-4">
        <TrackListSkeleton />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Icon name="x-mark" className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Error loading tracks</h3>
        <p className="text-muted-foreground mb-4">
          {error instanceof Error ? error.message : "Something went wrong"}
        </p>
      </div>
    );
  }

  return (
    <div className="py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Discover Music</h1>
          <p className="text-muted-foreground mt-1">Browse the global music catalog</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Select value={sort} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Sort discover">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recentlyAdded">Recently added</SelectItem>
                <SelectItem value="mostPlayed">Most played</SelectItem>
                <SelectItem value="mostLiked">Most liked</SelectItem>
                <SelectItem value="titleAZ">A-Z by title</SelectItem>
                <SelectItem value="artistAZ">A-Z by artist</SelectItem>
              </SelectContent>
            </Select>
            <SortDirectionToggle
              value={direction}
              onValueChange={handleDirectionChange}
              aria-label="Discover sort direction"
            />
          </div>
        </div>
      </div>

      {allItems.length === 0 && !isFetching ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Icon name="magnifying-glass" className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No tracks found</h3>
          <p className="text-muted-foreground mb-4">
            The music catalog is empty. Upload some tracks to get started.
          </p>
        </div>
      ) : (
        <div ref={listRef} data-testid="discover-track-list" className="relative min-w-0">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const isHeader = virtualItem.index === 0;
              const rowStyle = {
                position: "absolute" as const,
                top: 0,
                left: 0,
                width: "100%",
                transform: virtualRowOffset(virtualItem.start, scrollMargin),
              };

              if (isHeader) {
                return (
                  <div
                    key="header"
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{ ...rowStyle, position: "sticky", top: 0, zIndex: 10 }}
                    className="bg-background border-b h-16"
                  >
                    <div className="flex items-center gap-4 px-1 py-3 text-sm font-medium text-muted-foreground sm:px-4">
                      <div className="w-8 flex items-center justify-center min-w-8">#</div>
                      <div className="flex-1 min-w-0">Title</div>
                      <div className="hidden md:flex text-xs text-muted-foreground w-12 text-center">
                        Duration
                      </div>
                      <div className="flex items-center gap-1 w-8">Actions</div>
                    </div>
                  </div>
                );
              }

              const itemIndex = virtualItem.index - 1;

              if (itemIndex >= allItems.length) {
                return (
                  <div
                    key="loading"
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={rowStyle}
                  >
                    <div className="flex w-full justify-center py-4">
                      {isFetchingNextPage ? (
                        <Icon name="update" className="h-6 w-6 animate-spin" />
                      ) : hasNextPage ? (
                        "Loading more..."
                      ) : (
                        "Nothing more to load"
                      )}
                    </div>
                  </div>
                );
              }

              const item = allItems[itemIndex];
              if (!item) return null;

              return (
                <div
                  key={item.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={rowStyle}
                >
                  <DiscoverTrackListItem
                    track={item}
                    index={itemIndex}
                    sort={sort}
                    direction={direction}
                    playlists={playlists}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
