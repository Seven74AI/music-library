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

/**
 * Discriminated union keyed on `type` instead of a 10-field optional data
 * clump: each variant carries only the fields that are meaningful for it, so
 * narrowing on `type` (in isSamePlayContext / playlistContextFromJson /
 * toQueueSpineContext / playContextToJson) type-checks the correct fields and
 * rejects cross-variant access.
 */
export type PlaylistContext =
  | { type: "library"; librarySort?: LibrarySortOption; sortDirection?: SortDirection }
  | {
      type: "playlist";
      playlistId?: string;
      sort?: PlaylistTrackSortOption;
      sortDirection?: SortDirection;
    }
  | { type: "artist"; artistId?: string }
  | { type: "album"; albumId?: string }
  | { type: "track"; trackId?: string }
  | { type: "music" }
  | {
      type: "discover";
      discoverSort?: DiscoverSortOption;
      sortDirection?: SortDirection;
    }
  | { type: "onRepeatSnapshot"; snapshotId?: string };

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
  switch (a.type) {
    case "playlist": {
      const pb = b as Extract<PlaylistContext, { type: "playlist" }>;
      return (
        a.playlistId === pb.playlistId &&
        playlistSortOrCustom(a.sort) === playlistSortOrCustom(pb.sort) &&
        playlistSortDirectionOrDefault(a.sort, a.sortDirection) ===
          playlistSortDirectionOrDefault(pb.sort, pb.sortDirection)
      );
    }
    case "library": {
      const lb = b as Extract<PlaylistContext, { type: "library" }>;
      return (
        librarySortOrDefault(a.librarySort) === librarySortOrDefault(lb.librarySort) &&
        librarySortDirectionOrDefault(a.librarySort, a.sortDirection) ===
          librarySortDirectionOrDefault(lb.librarySort, lb.sortDirection)
      );
    }
    case "discover": {
      const db = b as Extract<PlaylistContext, { type: "discover" }>;
      const sortA = a.discoverSort ?? DEFAULT_DISCOVER_SORT;
      const sortB = db.discoverSort ?? DEFAULT_DISCOVER_SORT;
      return (
        sortA === sortB &&
        parseSortDirection(a.sortDirection, defaultDiscoverSortDirection(sortA)) ===
          parseSortDirection(db.sortDirection, defaultDiscoverSortDirection(sortB))
      );
    }
    case "artist":
      return a.artistId === (b as Extract<PlaylistContext, { type: "artist" }>).artistId;
    case "album":
      return a.albumId === (b as Extract<PlaylistContext, { type: "album" }>).albumId;
    case "track":
      return a.trackId === (b as Extract<PlaylistContext, { type: "track" }>).trackId;
    case "onRepeatSnapshot":
      return (
        a.snapshotId === (b as Extract<PlaylistContext, { type: "onRepeatSnapshot" }>).snapshotId
      );
    case "music":
      return true;
  }
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
