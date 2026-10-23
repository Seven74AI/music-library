import { type QueueSpineContext } from "#app/features/queue/queue-spine.ts";
import {
  DEFAULT_LIBRARY_SORT,
  defaultLibrarySortDirection,
  parseLibrarySort,
  type LibrarySortOption,
} from "#app/features/listening-insights/heavy-rotation.ts";
import {
  type PlayContextJson,
  type PlayerStateData,
} from "#app/features/player-state/player-state.ts";
import {
  DEFAULT_DISCOVER_SORT,
  defaultDiscoverSortDirection,
  parseDiscoverSort,
  type DiscoverSortOption,
} from "#app/utils/discover.ts";
import {
  defaultPlaylistTrackSortDirection,
  parsePlaylistTrackSort,
  type PlaylistTrackSortOption,
} from "#app/utils/playlist-track-sort.ts";
import { parseSortDirection, type SortDirection } from "#app/utils/sort-direction.ts";

export type PlayContext =
  | "library"
  | "playlist"
  | "artist"
  | "album"
  | "track"
  | "discover"
  | "onRepeatSnapshot";

export interface PlaylistContext {
  type: PlayContext;
  playlistId?: string;
  artistId?: string;
  albumId?: string;
  trackId?: string;
  snapshotId?: string;
  cursor?: string;
  /** Active playlist track sort; only meaningful for playlist context. */
  sort?: PlaylistTrackSortOption;
  /** Active library sort; only meaningful for library context. */
  librarySort?: LibrarySortOption;
  /** Active Discover sort; only meaningful for discover context. */
  discoverSort?: DiscoverSortOption;
  /** Asc/desc for the active library or playlist sort. */
  sortDirection?: SortDirection;
}

export function playlistSortOrCustom(
  sort: PlaylistTrackSortOption | undefined,
): PlaylistTrackSortOption {
  return sort ?? "custom";
}

export function librarySortOrDefault(sort: LibrarySortOption | undefined): LibrarySortOption {
  return sort ?? DEFAULT_LIBRARY_SORT;
}

export function playlistSortDirectionOrDefault(
  sort: PlaylistTrackSortOption | undefined,
  direction: SortDirection | undefined,
): SortDirection {
  return parseSortDirection(
    direction,
    defaultPlaylistTrackSortDirection(playlistSortOrCustom(sort)),
  );
}

export function librarySortDirectionOrDefault(
  sort: LibrarySortOption | undefined,
  direction: SortDirection | undefined,
): SortDirection {
  return parseSortDirection(direction, defaultLibrarySortDirection(librarySortOrDefault(sort)));
}

export function isSamePlayContext(a: PlaylistContext | null, b: PlaylistContext): boolean {
  if (!a || a.type !== b.type) return false;
  if (a.playlistId !== b.playlistId) return false;
  if (a.artistId !== b.artistId) return false;
  if (a.albumId !== b.albumId) return false;
  if (a.trackId !== b.trackId) return false;
  if (a.snapshotId !== b.snapshotId) return false;
  if (a.type === "playlist") {
    return (
      playlistSortOrCustom(a.sort) === playlistSortOrCustom(b.sort) &&
      playlistSortDirectionOrDefault(a.sort, a.sortDirection) ===
        playlistSortDirectionOrDefault(b.sort, b.sortDirection)
    );
  }
  if (a.type === "library") {
    return (
      librarySortOrDefault(a.librarySort) === librarySortOrDefault(b.librarySort) &&
      librarySortDirectionOrDefault(a.librarySort, a.sortDirection) ===
        librarySortDirectionOrDefault(b.librarySort, b.sortDirection)
    );
  }
  if (a.type === "discover") {
    const sortA = a.discoverSort ?? DEFAULT_DISCOVER_SORT;
    const sortB = b.discoverSort ?? DEFAULT_DISCOVER_SORT;
    return (
      sortA === sortB &&
      parseSortDirection(a.sortDirection, defaultDiscoverSortDirection(sortA)) ===
        parseSortDirection(b.sortDirection, defaultDiscoverSortDirection(sortB))
    );
  }
  return true;
}

export function playlistContextFromJson(context: PlayContextJson | null): PlaylistContext | null {
  if (!context) return null;
  if (context.type === "playlist") {
    const sort = parsePlaylistTrackSort(context.sort);
    return {
      type: "playlist",
      playlistId: context.playlistId,
      sort,
      sortDirection: parseSortDirection(context.direction, defaultPlaylistTrackSortDirection(sort)),
    };
  }
  if (context.type === "library") {
    const librarySort = parseLibrarySort(context.sort);
    return {
      type: "library",
      librarySort,
      sortDirection: parseSortDirection(
        context.direction,
        defaultLibrarySortDirection(librarySort),
      ),
    };
  }
  if (context.type === "discover") {
    const discoverSort = parseDiscoverSort(context.sort);
    return {
      type: "discover",
      discoverSort,
      sortDirection: parseSortDirection(
        context.direction,
        defaultDiscoverSortDirection(discoverSort),
      ),
    };
  }
  return context;
}

export function toQueueSpineContext(context: PlaylistContext): QueueSpineContext | null {
  if (context.type === "library") {
    return {
      type: "library",
      sort: librarySortOrDefault(context.librarySort),
      direction: librarySortDirectionOrDefault(context.librarySort, context.sortDirection),
    };
  }
  if (context.type === "playlist" && context.playlistId) {
    return {
      type: "playlist",
      playlistId: context.playlistId,
      sort: playlistSortOrCustom(context.sort),
      direction: playlistSortDirectionOrDefault(context.sort, context.sortDirection),
    };
  }
  if (context.type === "artist" && context.artistId) {
    return { type: "artist", artistId: context.artistId };
  }
  if (context.type === "album" && context.albumId) {
    return { type: "album", albumId: context.albumId };
  }
  if (context.type === "track" && context.trackId) {
    return { type: "track", trackId: context.trackId };
  }
  if (context.type === "onRepeatSnapshot" && context.snapshotId) {
    return { type: "onRepeatSnapshot", snapshotId: context.snapshotId };
  }
  if (context.type === "discover") {
    const sort = context.discoverSort ?? DEFAULT_DISCOVER_SORT;
    return {
      type: "discover",
      sort,
      direction: parseSortDirection(context.sortDirection, defaultDiscoverSortDirection(sort)),
    };
  }
  return null;
}

/** Reduce a client `PlaylistContext` to the persisted spine-reconstructing subset. */
export function playContextToJson(context: PlaylistContext | null): PlayContextJson | null {
  if (!context) return null;
  if (context.type === "library") {
    const sort = librarySortOrDefault(context.librarySort);
    const direction = librarySortDirectionOrDefault(context.librarySort, context.sortDirection);
    return {
      type: "library",
      ...(sort !== DEFAULT_LIBRARY_SORT ? { sort } : {}),
      ...(direction !== defaultLibrarySortDirection(sort) ? { direction } : {}),
    };
  }
  if (context.type === "playlist" && context.playlistId) {
    const sort = playlistSortOrCustom(context.sort);
    const direction = playlistSortDirectionOrDefault(context.sort, context.sortDirection);
    return {
      type: "playlist",
      playlistId: context.playlistId,
      ...(sort !== "custom" ? { sort } : {}),
      ...(direction !== defaultPlaylistTrackSortDirection(sort) ? { direction } : {}),
    };
  }
  if (context.type === "artist" && context.artistId) {
    return { type: "artist", artistId: context.artistId };
  }
  if (context.type === "album" && context.albumId) {
    return { type: "album", albumId: context.albumId };
  }
  if (context.type === "track" && context.trackId) {
    return { type: "track", trackId: context.trackId };
  }
  if (context.type === "onRepeatSnapshot" && context.snapshotId) {
    return { type: "onRepeatSnapshot", snapshotId: context.snapshotId };
  }
  if (context.type === "discover") {
    const sort = context.discoverSort ?? DEFAULT_DISCOVER_SORT;
    const direction = parseSortDirection(context.sortDirection, defaultDiscoverSortDirection(sort));
    return {
      type: "discover",
      ...(sort !== DEFAULT_DISCOVER_SORT ? { sort } : {}),
      ...(direction !== defaultDiscoverSortDirection(sort) ? { direction } : {}),
    };
  }
  return null; // no spine context for this type
}

export function hasPersistableQueue(state: PlayerStateData): boolean {
  return Boolean(state.currentTrackId || state.upNextIds.length > 0 || state.playContext);
}

/** Persist after a successful online restore, or after the user starts a real queue. */
export function shouldPersistPlayerState(
  userId: string,
  restoredForUserId: string | null,
  userMutatedQueue: boolean,
  state: PlayerStateData,
): boolean {
  if (restoredForUserId === userId) return true;
  return userMutatedQueue && hasPersistableQueue(state);
}
