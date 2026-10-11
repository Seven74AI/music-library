import { useInfiniteQuery } from "@tanstack/react-query";
import { useWindowVirtualizer, defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState } from "react";
import { data, Link, useSearchParams } from "react-router";
import { useCuratorFilterSession } from "#app/features/curator/use-curator-session.ts";
import { BulkEditDialog } from "#app/components/bulk-edit-dialog";
import { OfflineLibraryView } from "#app/components/offline/offline-library-view.tsx";
import { SelectionModeToggle } from "#app/components/selection-mode-toggle";
import { SortDirectionToggle } from "#app/components/sort-direction-toggle.tsx";
import { TrackListItem } from "#app/components/track-list-item";
import { TrackListSelectionControls } from "#app/components/track-list-selection-controls";
import { useSelection, useSelectionMode } from "#app/features/curator/selection.ts";
import { Checkbox } from "#app/components/ui/checkbox.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { Label } from "#app/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { TrackListSkeleton } from "#app/components/ui/track-list-skeleton";
import {
  defaultLibrarySortDirection,
  parseLibrarySort,
  type LibrarySortOption,
} from "#app/features/listening-insights/index.ts";
import { listLibraryUserTracks } from "#app/features/listening-insights/library-tracks.server.ts";
import { type LibraryOfflineLoaderData } from "#app/features/offline-app/offline-route-policies.client.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { LIBRARY_TRACKS_PAGE_SIZE } from "#app/utils/library-tracks-pagination.ts";
import {
  parseHasAudioOnlyParam,
  parseLibraryGenreParam,
} from "#app/utils/library-user-tracks.server.ts";
import { parseSortDirection, type SortDirection } from "#app/utils/sort-direction.ts";
import {
  estimateTrackListItemSize,
  measureTrackListElement,
  useListScrollMargin,
  virtualRowOffset,
} from "#app/utils/track-list-virtualizer.ts";
import { userIsCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { type Route } from "./+types/library.index.ts";

// Define the track type
type UserTrack = {
  id: string;
  createdAt: Date;
  track: {
    id: string;
    title: string;
    artist: {
      id: string;
      name: string;
    };
    duration: number | null;
    coverImage: {
      objectKey: string;
    } | null;
    albumRecord?: { id: string; name: string } | null;
    serviceUrl: string | null;
    createdAt?: Date;
    releaseDate?: Date | null;
    originalDate?: Date | null;
    service?: {
      displayName: string;
      logoUrl: string | null;
    } | null;
    audioFiles?: Array<{
      id: string;
      format: string | null;
      objectKey: string;
    }>;
    curatorNotesCount?: number;
  };
};

type LibraryTrackListItemProps = {
  track: UserTrack["track"];
  userTrack: UserTrack;
  index: number;
  librarySort: LibrarySortOption;
  sortDirection: SortDirection;
  playlists: Array<{
    id: string;
    title: string;
    description: string | null;
    _count: { tracks: number };
  }>;
  showCheckbox?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (trackId: string) => void;
  isCurator?: boolean;
};

function libraryHrefWithoutGenre(searchParams: URLSearchParams) {
  const nextParams = new URLSearchParams(searchParams);
  nextParams.delete("genre");
  const query = nextParams.toString();
  return query ? `/library?${query}` : "/library";
}

function LibraryTrackListItem({
  track,
  userTrack,
  index,
  librarySort,
  sortDirection,
  playlists,
  showCheckbox = false,
  isSelected = false,
  onToggleSelection,
  isCurator = false,
}: LibraryTrackListItemProps) {
  return (
    <TrackListItem
      track={{ ...track, album: track.albumRecord ?? null }}
      userTrack={userTrack}
      index={index}
      playlists={playlists}
      playlistContext={{ type: "library", librarySort, sortDirection }}
      showQuickAddToPlaylist
      showAudioFileDownload
      showCheckbox={showCheckbox}
      isSelected={isSelected}
      onToggleSelection={onToggleSelection}
      curatorNotesCount={isCurator ? (track.curatorNotesCount ?? 0) : 0}
      isCurator={isCurator}
    />
  );
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || String(LIBRARY_TRACKS_PAGE_SIZE))),
  );
  const hasAudioOnly = parseHasAudioOnlyParam(url.searchParams);
  const genreId = parseLibraryGenreParam(url.searchParams);
  const sort = parseLibrarySort(url.searchParams.get("sort"));
  const direction = parseSortDirection(
    url.searchParams.get("dir"),
    defaultLibrarySortDirection(sort),
  );

  const { userTracks, pagination } = await listLibraryUserTracks({
    userId,
    sort,
    direction,
    hasAudioOnly,
    genreId,
    cursor,
    limit,
  });

  // Add playlists to loader
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

  const isCurator = await userIsCuratorOrAdmin(userId);
  const genre = genreId
    ? await prisma.genre.findUnique({
        where: { id: genreId },
        select: { id: true, name: true },
      })
    : null;

  return data({
    userTracks,
    pagination,
    hasAudioOnly,
    sort,
    direction,
    playlists,
    isCurator,
    genreId,
    genre,
  });
}

export default function LibraryIndexRoute({
  loaderData,
}: {
  loaderData: Route.ComponentProps["loaderData"] | LibraryOfflineLoaderData | undefined;
}) {
  const safeLoaderData = loaderData || {
    offline: false as const,
    offlineTracks: [],
    userTracks: [],
    pagination: { hasNext: false, nextCursor: null, limit: LIBRARY_TRACKS_PAGE_SIZE },
    hasAudioOnly: false,
    sort: "dateAdded" as LibrarySortOption,
    direction: "desc" as SortDirection,
    playlists: [],
    isCurator: false,
    genreId: null,
    genre: null,
  };
  const {
    userTracks,
    pagination,
    playlists,
    hasAudioOnly = false,
    sort: loaderSort = "dateAdded",
    direction: loaderDirection = "desc",
    isCurator = false,
    genreId = null,
    genre = null,
  } = safeLoaderData;
  const offline = "offline" in safeLoaderData && safeLoaderData.offline;
  const offlineTracks =
    "offlineTracks" in safeLoaderData && Array.isArray(safeLoaderData.offlineTracks)
      ? safeLoaderData.offlineTracks
      : [];
  const pageSize = pagination?.limit ?? LIBRARY_TRACKS_PAGE_SIZE;
  const [searchParams, setSearchParams] = useSearchParams();
  const clearGenreFilterHref = libraryHrefWithoutGenre(searchParams);
  const sort = parseLibrarySort(searchParams.get("sort") ?? loaderSort);
  const direction = parseSortDirection(
    searchParams.get("dir") ?? loaderDirection,
    defaultLibrarySortDirection(sort),
  );
  const listRef = useRef<HTMLDivElement>(null);

  // Selection mode and state management
  const { selectionMode } = useSelectionMode();
  const { selectedTrackIds, selectAll, deselectAll, toggleSelection, selectedCount } =
    useSelection();
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const libraryFilters = {
    sort: searchParams.get("sort") ?? "",
    dir: searchParams.get("dir") ?? "",
    hasAudio: searchParams.get("hasAudio") ?? "",
    genre: searchParams.get("genre") ?? "",
  };
  useCuratorFilterSession({
    enabled: isCurator,
    page: "/library",
    filters: libraryFilters,
    active: searchParams.toString().length > 0,
    readScroll: () => window.scrollY,
    onRestore: (state) => {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(state.filters)) {
        if (value == null || value === false || value === "") continue;
        next.set(key, String(value));
      }
      setSearchParams(next, { preventScrollReset: true });
      window.setTimeout(() => {
        window.scrollTo(0, state.scrollPosition);
      }, 50);
    },
  });

  const scrollLibraryToTop = useCallback(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const handleHasAudioOnlyChange = useCallback(
    (checked: boolean | "indeterminate") => {
      const nextParams = new URLSearchParams(searchParams);
      if (checked === true) {
        nextParams.set("hasAudio", "1");
      } else {
        nextParams.delete("hasAudio");
      }
      setSearchParams(nextParams, { preventScrollReset: true });
      scrollLibraryToTop();
    },
    [searchParams, setSearchParams, scrollLibraryToTop],
  );

  const handleSortChange = useCallback(
    (value: string) => {
      const nextSort = parseLibrarySort(value);
      const nextParams = new URLSearchParams(searchParams);
      if (nextSort === "dateAdded") {
        nextParams.delete("sort");
      } else {
        nextParams.set("sort", nextSort);
      }
      nextParams.delete("dir");
      setSearchParams(nextParams, { preventScrollReset: true });
      scrollLibraryToTop();
    },
    [searchParams, setSearchParams, scrollLibraryToTop],
  );

  const handleDirectionChange = useCallback(
    (next: SortDirection) => {
      const nextParams = new URLSearchParams(searchParams);
      if (next === defaultLibrarySortDirection(sort)) {
        nextParams.delete("dir");
      } else {
        nextParams.set("dir", next);
      }
      setSearchParams(nextParams, { preventScrollReset: true });
      scrollLibraryToTop();
    },
    [searchParams, setSearchParams, scrollLibraryToTop, sort],
  );

  // Use useInfiniteQuery for data fetching
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
    queryKey: ["user-tracks", { pageSize, hasAudioOnly, sort, direction, genreId }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      if (pageParam) {
        params.set("cursor", String(pageParam));
      }
      if (hasAudioOnly) {
        params.set("hasAudio", "1");
      }
      if (genreId) {
        params.set("genre", genreId);
      }
      if (sort !== "dateAdded") {
        params.set("sort", sort);
      }
      if (direction !== defaultLibrarySortDirection(sort)) {
        params.set("dir", direction);
      }
      const res = await fetch(`/api/user-tracks?${params}`);
      const json = (await res.json()) as {
        userTracks: UserTrack[];
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
                userTracks: userTracks || [],
                pagination: {
                  hasNext: pagination?.hasNext || false,
                  nextCursor: pagination?.nextCursor || null,
                },
              },
            ],
            pageParams: [undefined],
          }
        : undefined,
    enabled: !offline,
  });

  // Flatten all pages into a single array
  const allItems = queryData?.pages.flatMap((page) => page.userTracks) || [];

  // Selection handlers for bulk editing
  const handleSelectAll = useCallback(() => {
    selectAll(allItems.map((item) => item.track.id));
  }, [allItems, selectAll]);

  const handleDeselectAll = useCallback(() => {
    deselectAll();
  }, [deselectAll]);

  const handleToggleSelection = useCallback(
    (trackId: string) => {
      toggleSelection(trackId);
    },
    [toggleSelection],
  );

  const handleBulkEditSuccess = useCallback(() => {
    deselectAll();
    setBulkEditOpen(false);
    // Refetch the data to show updated tracks
    window.location.reload();
  }, [deselectAll]);

  // One document scroller. A nested 600px ScrollArea fought the page scroll on
  // mobile, and its 64px slots were shorter than the 80px track rows.
  const listReady = !offline && status === "success" && allItems.length > 0;
  const scrollMargin = useListScrollMargin(listRef, listReady);
  const virtualizer = useWindowVirtualizer({
    count: 1 + allItems.length + (hasNextPage ? 1 : 0), // 1 for header + items + 1 for loading indicator
    estimateSize: (index) => estimateTrackListItemSize(index, true),
    measureElement: measureTrackListElement,
    overscan: 5,
    scrollMargin,
    rangeExtractor: useCallback((range: Range) => {
      const next = new Set([0, ...defaultRangeExtractor(range)]);
      return [...next].sort((a, b) => a - b);
    }, []),
  });

  // Monitor when last virtual item is rendered for infinite scroll
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const [lastItem] = [...virtualItems].reverse();

    if (!lastItem) return;

    // When last virtual item index >= last data index - 1, fetch more
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

  // Show loading skeleton while data is being processed
  if (offline) {
    return (
      <div className="py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Music Library</h1>
          <p className="text-muted-foreground mt-2">Showing downloaded tracks available offline.</p>
        </div>
        <OfflineLibraryView tracks={offlineTracks} />
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <TrackListSkeleton />
      </div>
    );
  }

  // Show error state
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
          <h1 className="text-2xl font-bold">Music Library</h1>
          {genre && allItems.length > 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">
              Showing tracks tagged with{" "}
              <span className="font-medium text-foreground">{genre.name}</span>.{" "}
              <Link to={clearGenreFilterHref} className="underline">
                Clear filter
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Select value={sort} onValueChange={handleSortChange}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Sort library">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dateAdded">Recently added</SelectItem>
                <SelectItem value="mostPlayedMonth">Most played · this month</SelectItem>
                <SelectItem value="mostPlayedEver">Most played · ever</SelectItem>
              </SelectContent>
            </Select>
            <SortDirectionToggle
              value={direction}
              onValueChange={handleDirectionChange}
              aria-label="Library sort direction"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="has-audio-only"
              checked={hasAudioOnly}
              onCheckedChange={handleHasAudioOnlyChange}
            />
            <Label htmlFor="has-audio-only" className="text-sm font-normal cursor-pointer">
              Only tracks with audio
            </Label>
          </div>
        </div>
      </div>

      {/* Selection Mode Toggle */}
      {isCurator && allItems.length > 0 && (
        <div className="mb-4">
          <SelectionModeToggle />
        </div>
      )}

      {/* Selection Controls for Bulk Editing */}
      {isCurator && selectionMode && allItems.length > 0 && (
        <TrackListSelectionControls
          selectedCount={selectedCount}
          totalCount={allItems.length}
          allSelected={selectedCount === allItems.length && allItems.length > 0}
          onSelectAll={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          onBulkEdit={() => setBulkEditOpen(true)}
          isCurator={isCurator}
        />
      )}

      {allItems.length === 0 && !isFetching ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Icon name="file-text" className="h-12 w-12 text-muted-foreground mb-4" />
          {genre ? (
            <>
              <h3 className="text-lg font-semibold mb-2">No tracks tagged with {genre.name}</h3>
              <p className="text-muted-foreground mb-4">
                None of the tracks in your library use this genre.
              </p>
              <Link to={clearGenreFilterHref} className="underline">
                Clear filter
              </Link>
            </>
          ) : genreId ? (
            <>
              <h3 className="text-lg font-semibold mb-2">No tracks match this genre</h3>
              <p className="text-muted-foreground mb-4">
                Nothing in your library is tagged with this genre.
              </p>
              <Link to={clearGenreFilterHref} className="underline">
                Clear filter
              </Link>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold mb-2">No tracks yet</h3>
              <p className="text-muted-foreground mb-4">
                Start building your music library by uploading tracks.
              </p>
            </>
          )}
        </div>
      ) : (
        <div ref={listRef} data-testid="library-track-list" className="relative min-w-0">
          <div
            data-testid="library-virtual-spacer"
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
                    data-testid="library-virtual-row"
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

              // Adjust index for actual items (skip header)
              const itemIndex = virtualItem.index - 1;

              if (itemIndex >= allItems.length) {
                // Loading indicator
                return (
                  <div
                    key="loading"
                    data-index={virtualItem.index}
                    data-testid="library-virtual-row"
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
                  data-testid="library-virtual-row"
                  ref={virtualizer.measureElement}
                  style={rowStyle}
                >
                  <LibraryTrackListItem
                    track={item.track}
                    userTrack={item}
                    index={itemIndex}
                    librarySort={sort}
                    sortDirection={direction}
                    playlists={playlists}
                    showCheckbox={isCurator && selectionMode}
                    isSelected={selectedTrackIds.has(item.track.id)}
                    onToggleSelection={handleToggleSelection}
                    isCurator={isCurator}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk Edit Dialog */}
      {isCurator && (
        <BulkEditDialog
          trackIds={Array.from(selectedTrackIds)}
          open={bulkEditOpen}
          onClose={() => setBulkEditOpen(false)}
          onSuccess={handleBulkEditSuccess}
        />
      )}
    </div>
  );
}
