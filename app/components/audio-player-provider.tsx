import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { isOfflineEnvironment } from "#app/features/offline-app/is-offline-environment.client.ts";
import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";
import { offlineSummaryToFullTrack } from "#app/features/offline-storage/offline-track-summary.client.ts";
import { isQueueCacheEnabled } from "#app/features/offline-storage/queue-cache-preference.client.ts";
import {
  peekCachedPlaybackUrl,
  prefetchPlaybackAudioUrl,
} from "#app/features/offline-storage/resolve-playback-url.client.ts";
import {
  collectHydrationIds,
  fetchPlaybackBatch,
  hydratePlaybackCacheInBatches,
  PlaybackHydrationCache,
  resolveFullTrack,
  resolveFullTracks,
} from "#app/features/queue/queue-hydration.ts";
import {
  advanceAfterPlay,
  buildFlatQueueView,
  findSpinePositionForTrackId,
  flatIndexForSpinePosition,
  getTrackAtTarget,
  getQueueSpineDisplayTracks,
  hasNextTrack,
  hasPreviousTrack,
  jumpToTarget,
  resolveNextTrack,
  resolvePreviousTrack,
  type LoopMode,
  type QueueNavigationState,
  type QueueTarget,
} from "#app/features/queue/queue-navigation.ts";
import {
  createShuffledOrder,
  generateShuffleSeed,
  reshuffleFromCurrent,
} from "#app/features/queue/queue-shuffle.ts";
import {
  AuthExpiredError,
  fetchQueueSpine,
  queueTrackFromFullTrack,
  type QueueSpineContext,
} from "#app/features/queue/queue-spine.ts";
import {
  readCachedPlayerState,
  writeCachedPlayerState,
} from "#app/features/player-state/player-state-cache.client.ts";
import {
  fetchPlayerState,
  persistPlayerState,
  type PlayContextJson,
  type PlayerStateData,
} from "#app/features/player-state/player-state.ts";
import { useOnlineStatus } from "#app/hooks/use-online-status.ts";
import { type FullTrack, type QueueTrack } from "#app/types/frontend/shared";
import { isPlayableTrack } from "#app/utils/playable-track";
import {
  defaultPlaylistTrackSortDirection,
  parsePlaylistTrackSort,
  type PlaylistTrackSortOption,
} from "#app/utils/playlist-track-sort.ts";
import {
  DEFAULT_DISCOVER_SORT,
  defaultDiscoverSortDirection,
  parseDiscoverSort,
  type DiscoverSortOption,
} from "#app/utils/discover.ts";
import {
  DEFAULT_LIBRARY_SORT,
  defaultLibrarySortDirection,
  parseLibrarySort,
  type LibrarySortOption,
} from "#app/features/listening-insights/heavy-rotation.ts";
import { parseSortDirection, type SortDirection } from "#app/utils/sort-direction.ts";
import { AudioPlayer } from "./audio-player";
import { InstallAppBanner } from "./pwa/install-app-banner";
import { toast } from "./ui/use-toast";

type Track = FullTrack;

type PlayContext =
  | "library"
  | "playlist"
  | "artist"
  | "album"
  | "track"
  | "music"
  | "discover"
  | "onRepeatSnapshot";

interface PlaylistContext {
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

interface AudioPlayerContextType {
  currentTrack: Track | null;
  isPlayerVisible: boolean;
  playlist: Track[];
  upNext: Track[];
  spine: Track[];
  spineTotal: number;
  spinePosition: number;
  currentIndex: number;
  playContext: PlaylistContext | null;
  loopMode: LoopMode;
  isShuffleEnabled: boolean;
  playTrack: (track: Track, context: PlaylistContext, index?: number) => void;
  playPlaylist: (tracks: Track[], context: PlaylistContext, startIndex?: number) => void;
  playLibrary: (sort?: LibrarySortOption) => Promise<void>;
  playUserPlaylist: (playlistId: string, sort?: PlaylistTrackSortOption) => Promise<void>;
  playNext: () => void;
  playPrevious: () => void;
  toggleLoop: () => void;
  toggleShuffle: () => void;
  closePlayer: () => void;
  startQueuePlayback: () => void;
  hasQueuedPlayback: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  isLoadingNext: boolean;
  addTrackToPlaylist: (track: Track, position?: "next" | "end") => void;
  removeTrackFromPlaylist: (target: QueueTarget) => void;
  removeCurrentFromQueue: () => void;
  playNextTrack: (track: Track) => void;
  addToUpNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  playQueueTrack: (target: QueueTarget) => void;
  hydrateTracksForDisplay: (ids: string[]) => void;
  /** @deprecated Use addToUpNext instead */
  addToCurrentPlaylist: (track: Track) => void;
  /** Party Room: stop writing personal PlayerState while this device is speaker. */
  suspendPersonalPersistence: () => void;
  resumePersonalPersistence: () => void;
  getPersonalPlayerSnapshot: () => PlayerStateData;
  restorePersonalPlayerSnapshot: (snapshot: PlayerStateData, wasVisible: boolean) => Promise<void>;
  /** Party Room host: play a room-queue track; personal UsageEvents suppressed. */
  playRoomSpeakerTrack: (
    track: Track,
    options: { roomId: string; code: string; onEnded?: () => void },
  ) => void;
  setRoomPlaybackPlaying: (playing: boolean) => void;
  /** Active room speaker session (null when not speaking for a room). */
  roomSpeaker: { roomId: string; code: string } | null;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined);

const EMPTY_PLAYER_STATE: PlayerStateData = {
  playContext: null,
  currentTrackId: null,
  upNextIds: [],
  shuffleSeed: null,
  loopMode: "off",
};

interface AudioPlayerProviderProps {
  children: ReactNode;
  /** The authenticated user's id, or `null` when signed out. Drives queue persistence + restore. */
  userId?: string | null;
}

function playlistSortOrCustom(sort: PlaylistTrackSortOption | undefined): PlaylistTrackSortOption {
  return sort ?? "custom";
}

function librarySortOrDefault(sort: LibrarySortOption | undefined): LibrarySortOption {
  return sort ?? DEFAULT_LIBRARY_SORT;
}

function playlistSortDirectionOrDefault(
  sort: PlaylistTrackSortOption | undefined,
  direction: SortDirection | undefined,
): SortDirection {
  return parseSortDirection(
    direction,
    defaultPlaylistTrackSortDirection(playlistSortOrCustom(sort)),
  );
}

function librarySortDirectionOrDefault(
  sort: LibrarySortOption | undefined,
  direction: SortDirection | undefined,
): SortDirection {
  return parseSortDirection(direction, defaultLibrarySortDirection(librarySortOrDefault(sort)));
}

function isSamePlayContext(a: PlaylistContext | null, b: PlaylistContext): boolean {
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

function playlistContextFromJson(context: PlayContextJson | null): PlaylistContext | null {
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

function toQueueSpineContext(context: PlaylistContext): QueueSpineContext | null {
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
function playContextToJson(context: PlaylistContext | null): PlayContextJson | null {
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
  return null; // "music" has no spine
}

function hasPersistableQueue(state: PlayerStateData): boolean {
  return Boolean(state.currentTrackId || state.upNextIds.length > 0 || state.playContext);
}

/** Persist after a successful online restore, or after the user starts a real queue. */
function shouldPersistPlayerState(
  userId: string,
  restoredForUserId: string | null,
  userMutatedQueue: boolean,
  state: PlayerStateData,
): boolean {
  if (restoredForUserId === userId) return true;
  return userMutatedQueue && hasPersistableQueue(state);
}

export function AudioPlayerProvider({ children, userId }: AudioPlayerProviderProps) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const [upNext, setUpNext] = useState<QueueTrack[]>([]);
  const [upNextPlayNextCount, setUpNextPlayNextCount] = useState(0);
  const [spine, setSpine] = useState<QueueTrack[]>([]);
  const [spineTotal, setSpineTotal] = useState(0);
  const [spineOrder, setSpineOrder] = useState<number[]>([]);
  const [spinePosition, setSpinePosition] = useState(0);
  const [playContext, setPlayContext] = useState<PlaylistContext | null>(null);
  const [loopMode, setLoopMode] = useState<LoopMode>("off");
  const [shuffleSeed, setShuffleSeed] = useState<number | null>(null);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [playbackToken, setPlaybackToken] = useState(0);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [roomSpeaker, setRoomSpeaker] = useState<{ roomId: string; code: string } | null>(null);
  const [roomPlaying, setRoomPlaying] = useState<boolean | null>(null);
  const persistenceSuspendedRef = useRef(false);
  const roomOnEndedRef = useRef<(() => void) | null>(null);

  const isShuffleEnabled = shuffleSeed !== null;

  const playbackCacheRef = useRef(new PlaybackHydrationCache());
  const playlistFetchEpochRef = useRef(0);
  const wantsAutoPlayRef = useRef(false);
  const unlockAutoplayRef = useRef<((trackId: string, cachedUrl: string) => boolean) | null>(null);
  const upNextPlayNextCountRef = useRef(0);

  // Throttle scroll-driven hydration: accumulate IDs during rapid scrolling,
  // flush as a single batch 300ms after the last scroll event.
  const pendingHydrationIdsRef = useRef(new Set<string>());
  const hydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror of the serializable queue state, kept in a ref so the debounced
  // write and the beforeunload flush always read the latest committed values.
  const playerStateRef = useRef<PlayerStateData>({
    playContext: null,
    currentTrackId: null,
    upNextIds: [],
    shuffleSeed: null,
    loopMode: "off",
  });
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // User id we last completed a successful *online* restore for. Persist and
  // unload-flush are gated on this matching the current user so we never:
  // - flush the initial empty snapshot over a saved queue (tab close mid-restore)
  // - write another user's in-memory queue onto this account after a switch
  // - persist an offline-truncated Up Next (undownloaded ids dropped) to the server
  const onlineRestoredForUserIdRef = useRef<string | null>(null);
  // Bumped when `userId` changes so an in-flight restore cannot apply after a switch.
  const restoreEpochRef = useRef(0);
  // Track which restore path has run so a connectivity change doesn't re-run it
  // (or clobber an already-complete queue): offline partial restore runs at most
  // once, and a full online restore (initial load or post-offline backfill) runs
  // at most once.
  const offlineRestoreDoneRef = useRef(false);
  const onlineRestoreDoneRef = useRef(false);
  // Set immediately before the online restore writes queue state. A slower
  // offline partial restore must not apply after this — it would wipe the
  // spine and persist a truncated Up Next (only downloaded ids).
  const onlineRestoreAppliedRef = useRef(false);
  // Set when the user starts or edits a queue before (or instead of) restore.
  // In-flight restore must not overwrite that session.
  const userMutatedQueueRef = useRef(false);
  // Logout/login are client-side actions, so this provider stays mounted in
  // `root.tsx`. Drop the previous account's in-memory queue immediately — a
  // later 204 restore would otherwise enable persist while the old tracks are
  // still in state and write them onto the next user's PlayerState row.
  const [sessionUserId, setSessionUserId] = useState(userId);
  if (sessionUserId !== userId) {
    setSessionUserId(userId);
    restoreEpochRef.current += 1;
    playlistFetchEpochRef.current += 1;
    onlineRestoreDoneRef.current = false;
    offlineRestoreDoneRef.current = false;
    onlineRestoreAppliedRef.current = false;
    userMutatedQueueRef.current = false;
    onlineRestoredForUserIdRef.current = null;
    wantsAutoPlayRef.current = false;
    upNextPlayNextCountRef.current = 0;
    playbackCacheRef.current.clear();
    pendingHydrationIdsRef.current.clear();
    if (hydrationTimerRef.current) {
      clearTimeout(hydrationTimerRef.current);
      hydrationTimerRef.current = null;
    }
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    playerStateRef.current = EMPTY_PLAYER_STATE;
    setCurrentTrack(null);
    setIsPlayerVisible(false);
    setUpNext([]);
    setUpNextPlayNextCount(0);
    setSpine([]);
    setSpineTotal(0);
    setSpineOrder([]);
    setSpinePosition(0);
    setPlayContext(null);
    setLoopMode("off");
    setShuffleSeed(null);
    setIsLoadingNext(false);
  }

  const [persistEpoch, setPersistEpoch] = useState(0);

  const isOnline = useOnlineStatus();

  const noteUserQueueMutation = useCallback(() => {
    userMutatedQueueRef.current = true;
  }, []);

  const navigationState = useMemo<QueueNavigationState>(
    () => ({
      upNext,
      spine,
      spineOrder,
      spinePosition,
      loopMode,
    }),
    [upNext, spine, spineOrder, spinePosition, loopMode],
  );

  const playlist = useMemo(() => {
    void cacheVersion;
    return resolveFullTracks(playbackCacheRef.current, buildFlatQueueView(navigationState));
  }, [navigationState, cacheVersion]);

  const upNextView = useMemo(() => {
    void cacheVersion;
    return resolveFullTracks(playbackCacheRef.current, upNext);
  }, [upNext, cacheVersion]);

  const spineView = useMemo(() => {
    void cacheVersion;
    return resolveFullTracks(
      playbackCacheRef.current,
      getQueueSpineDisplayTracks(navigationState, currentTrack !== null),
    );
  }, [navigationState, cacheVersion, currentTrack]);

  const currentIndex = useMemo(() => {
    if (!currentTrack) return -1;

    const upNextIndex = upNext.findIndex((track) => track.id === currentTrack.id);
    if (upNextIndex >= 0) return upNextIndex;

    if (findSpinePositionForTrackId(navigationState, currentTrack.id) !== null) {
      return flatIndexForSpinePosition(navigationState, spinePosition);
    }

    return -1;
  }, [currentTrack, upNext, navigationState, spinePosition]);

  const beginPlayback = useCallback(() => {
    wantsAutoPlayRef.current = true;
    setPlaybackToken((token) => token + 1);
    // Cancel any pending scroll hydration from a previous queue
    if (hydrationTimerRef.current) {
      clearTimeout(hydrationTimerRef.current);
      hydrationTimerRef.current = null;
    }
    pendingHydrationIdsRef.current.clear();
  }, []);

  const rememberTrack = useCallback((track: Track) => {
    playbackCacheRef.current.set(track);
    setCacheVersion((version) => version + 1);
  }, []);

  /** Build a play order for a fresh spine, honouring the current shuffle seed. */
  const buildShuffledOrder = useCallback(
    (length: number) => createShuffledOrder(length, shuffleSeed !== null, shuffleSeed ?? undefined),
    [shuffleSeed],
  );

  const hydrateAround = useCallback(
    async (trackId: string | null) => {
      const ids = collectHydrationIds(navigationState, trackId);
      await playbackCacheRef.current.hydrateMissing(ids);
      setCacheVersion((version) => version + 1);
    },
    [navigationState],
  );

  const hydrateTracksForDisplay = useCallback((ids: string[]) => {
    if (ids.length === 0 || isOfflineEnvironment()) return;

    for (const id of ids) {
      const cached = playbackCacheRef.current.get(id);
      if (!cached?.coverImage) {
        pendingHydrationIdsRef.current.add(id);
      }
    }

    if (pendingHydrationIdsRef.current.size === 0) return;

    // Reset the debounce timer — flush 300ms after the last scroll event
    if (hydrationTimerRef.current) {
      clearTimeout(hydrationTimerRef.current);
    }

    hydrationTimerRef.current = setTimeout(() => {
      const needsHydration = [...pendingHydrationIdsRef.current];
      pendingHydrationIdsRef.current.clear();

      void (async () => {
        const updated = await hydratePlaybackCacheInBatches(
          playbackCacheRef.current,
          needsHydration,
          { refetchIncomplete: true },
        );
        if (updated > 0) {
          setCacheVersion((version) => version + 1);
        }
      })();
    }, 300);
  }, []);

  const fetchOfflineTracks = useCallback(async (context: PlaylistContext): Promise<Track[]> => {
    const storage = getOfflineStorage();
    const summaries =
      context.type === "playlist" && context.playlistId
        ? await storage.listForPlaylist(context.playlistId)
        : context.type === "library"
          ? await storage.listPinned()
          : await storage.listDownloaded();

    return summaries.map(offlineSummaryToFullTrack).filter(isPlayableTrack);
  }, []);

  const loadSpineForContext = useCallback(
    async (context: PlaylistContext): Promise<{ tracks: QueueTrack[]; total: number }> => {
      const spineContext = toQueueSpineContext(context);

      if (spineContext) {
        try {
          const result = await fetchQueueSpine(spineContext);
          if (result.tracks.length > 0) return result;
        } catch (error) {
          if (error instanceof AuthExpiredError) {
            window.location.href = "/login";
            return { tracks: [], total: 0 };
          }
          console.error("Failed to fetch queue spine:", error);
        }
      }

      const offlineTracks = await fetchOfflineTracks(context);
      for (const track of offlineTracks) {
        playbackCacheRef.current.set(track);
      }
      setCacheVersion((version) => version + 1);
      const tracks = offlineTracks.map(queueTrackFromFullTrack);
      return { tracks, total: tracks.length };
    },
    [fetchOfflineTracks],
  );

  const resetQueueState = useCallback(() => {
    setUpNext([]);
    setUpNextPlayNextCount(0);
    upNextPlayNextCountRef.current = 0;
    setSpine([]);
    setSpineTotal(0);
    setSpineOrder([]);
    setSpinePosition(0);
    playbackCacheRef.current.clear();
    setCacheVersion((version) => version + 1);
    // Cancel any pending scroll hydration from the old queue
    if (hydrationTimerRef.current) {
      clearTimeout(hydrationTimerRef.current);
      hydrationTimerRef.current = null;
    }
    pendingHydrationIdsRef.current.clear();
  }, []);

  const startSpinePlayback = useCallback(
    async (track: Track, context: PlaylistContext, explicitIndex?: number) => {
      rememberTrack(track);

      beginPlayback();
      setPlayContext(context);
      setIsPlayerVisible(true);
      setCurrentTrack(track);

      const epoch = ++playlistFetchEpochRef.current;
      setIsLoadingNext(true);

      try {
        const loadedSpine = await loadSpineForContext(context);
        if (epoch !== playlistFetchEpochRef.current) return;

        const order = buildShuffledOrder(loadedSpine.tracks.length);
        const resolvedPosition = (() => {
          if (explicitIndex !== undefined && loadedSpine.tracks[explicitIndex]?.id === track.id) {
            return order.findIndex((index) => index === explicitIndex);
          }
          return (
            findSpinePositionForTrackId(
              {
                upNext: [],
                spine: loadedSpine.tracks,
                spineOrder: order,
                spinePosition: 0,
                loopMode: "off",
              },
              track.id,
            ) ?? 0
          );
        })();

        setUpNext([]);
        setUpNextPlayNextCount(0);
        upNextPlayNextCountRef.current = 0;
        setSpine(loadedSpine.tracks);
        setSpineTotal(loadedSpine.total);
        setSpineOrder(order);
        setSpinePosition(resolvedPosition >= 0 ? resolvedPosition : 0);

        await hydrateAround(track.id);
      } finally {
        if (epoch === playlistFetchEpochRef.current) {
          setIsLoadingNext(false);
        }
      }
    },
    [beginPlayback, buildShuffledOrder, hydrateAround, loadSpineForContext, rememberTrack],
  );

  const resolvePlayableTrack = useCallback(
    async (queueTrack: QueueTrack): Promise<FullTrack | null> => {
      try {
        await hydrateAround(queueTrack.id);
      } catch {
        toast({
          title: "Playback failed",
          description: "Could not load the next track. Check your connection and try again.",
          variant: "destructive",
        });
        return null;
      }

      const fullTrack = resolveFullTrack(playbackCacheRef.current, queueTrack);
      if (!isPlayableTrack(fullTrack)) {
        toast({
          title: "Playback failed",
          description: "This track is unavailable. Try another track.",
          variant: "destructive",
        });
        return null;
      }

      return fullTrack;
    },
    [hydrateAround],
  );

  const playResolvedTrack = useCallback(
    async (queueTrack: QueueTrack): Promise<boolean> => {
      const fullTrack = await resolvePlayableTrack(queueTrack);
      if (!fullTrack) return false;

      beginPlayback();
      setCurrentTrack(fullTrack);
      return true;
    },
    [beginPlayback, resolvePlayableTrack],
  );

  const playTrack = useCallback(
    async (track: Track, context: PlaylistContext, index?: number) => {
      if (!isPlayableTrack(track)) return;

      noteUserQueueMutation();

      if (playContext && !isSamePlayContext(playContext, context)) {
        resetQueueState();
      }

      await startSpinePlayback(track, context, index);
    },
    [noteUserQueueMutation, playContext, resetQueueState, startSpinePlayback],
  );

  const playPlaylist = useCallback(
    (tracks: Track[], context: PlaylistContext, startIndex: number = 0) => {
      noteUserQueueMutation();
      setIsLoadingNext(true);
      try {
        const playableTracks = tracks.filter(isPlayableTrack);
        if (playableTracks.length === 0) return;

        const requestedTrack = tracks[startIndex];
        const resolvedStartIndex = requestedTrack
          ? playableTracks.findIndex((track) => track.id === requestedTrack.id)
          : 0;

        if (playContext && !isSamePlayContext(playContext, context)) {
          resetQueueState();
        }

        const loadedSpine = playableTracks.map(queueTrackFromFullTrack);
        const order = buildShuffledOrder(loadedSpine.length);
        const startTrack = playableTracks[resolvedStartIndex >= 0 ? resolvedStartIndex : 0];
        if (!startTrack) return;

        for (const track of playableTracks) {
          playbackCacheRef.current.set(track);
        }
        setCacheVersion((version) => version + 1);

        const startSpinePosition = order.findIndex(
          (index) => loadedSpine[index]?.id === startTrack.id,
        );

        setUpNext([]);
        setUpNextPlayNextCount(0);
        upNextPlayNextCountRef.current = 0;
        setSpine(loadedSpine);
        setSpineTotal(loadedSpine.length);
        setSpineOrder(order);
        setSpinePosition(startSpinePosition >= 0 ? startSpinePosition : 0);
        setPlayContext(context);
        setIsPlayerVisible(true);
        beginPlayback();
        setCurrentTrack(startTrack);
        void hydrateAround(startTrack.id);
      } finally {
        setIsLoadingNext(false);
      }
    },
    [
      beginPlayback,
      buildShuffledOrder,
      hydrateAround,
      noteUserQueueMutation,
      playContext,
      resetQueueState,
    ],
  );

  const playLibrary = useCallback(
    async (sort: LibrarySortOption = DEFAULT_LIBRARY_SORT) => {
      noteUserQueueMutation();
      setIsLoadingNext(true);
      try {
        const context: PlaylistContext = {
          type: "library",
          librarySort: librarySortOrDefault(sort),
        };
        if (!isSamePlayContext(playContext, context)) {
          resetQueueState();
        }

        const loadedSpine = await loadSpineForContext(context);
        if (loadedSpine.tracks.length === 0) return;

        const order = buildShuffledOrder(loadedSpine.tracks.length);
        const firstQueueTrack = loadedSpine.tracks[order[0] ?? 0];
        if (!firstQueueTrack) return;

        setUpNext([]);
        setUpNextPlayNextCount(0);
        upNextPlayNextCountRef.current = 0;
        setSpine(loadedSpine.tracks);
        setSpineTotal(loadedSpine.total);
        setSpineOrder(order);
        setSpinePosition(0);
        setPlayContext(context);
        setIsPlayerVisible(true);

        await hydrateAround(firstQueueTrack.id);
        const fullTrack = resolveFullTrack(playbackCacheRef.current, firstQueueTrack);
        if (!isPlayableTrack(fullTrack)) return;

        beginPlayback();
        setCurrentTrack(fullTrack);
      } finally {
        setIsLoadingNext(false);
      }
    },
    [
      beginPlayback,
      buildShuffledOrder,
      hydrateAround,
      loadSpineForContext,
      noteUserQueueMutation,
      playContext,
      resetQueueState,
    ],
  );

  const playUserPlaylist = useCallback(
    async (playlistId: string, sort: PlaylistTrackSortOption = "custom") => {
      noteUserQueueMutation();
      setIsLoadingNext(true);
      try {
        const context: PlaylistContext = {
          type: "playlist",
          playlistId,
          sort: playlistSortOrCustom(sort),
        };
        if (!isSamePlayContext(playContext, context)) {
          resetQueueState();
        }

        const loadedSpine = await loadSpineForContext(context);
        if (loadedSpine.tracks.length === 0) return;

        const order = buildShuffledOrder(loadedSpine.tracks.length);
        const firstQueueTrack = loadedSpine.tracks[order[0] ?? 0];
        if (!firstQueueTrack) return;

        setUpNext([]);
        setUpNextPlayNextCount(0);
        upNextPlayNextCountRef.current = 0;
        setSpine(loadedSpine.tracks);
        setSpineTotal(loadedSpine.total);
        setSpineOrder(order);
        setSpinePosition(0);
        setPlayContext(context);
        setIsPlayerVisible(true);

        await hydrateAround(firstQueueTrack.id);
        const fullTrack = resolveFullTrack(playbackCacheRef.current, firstQueueTrack);
        if (!isPlayableTrack(fullTrack)) return;

        beginPlayback();
        setCurrentTrack(fullTrack);
      } finally {
        setIsLoadingNext(false);
      }
    },
    [
      beginPlayback,
      buildShuffledOrder,
      hydrateAround,
      loadSpineForContext,
      noteUserQueueMutation,
      playContext,
      resetQueueState,
    ],
  );

  const addTrackToPlaylist = useCallback(
    (track: Track, position: "next" | "upNext" | "end" = "end") => {
      if (!isPlayableTrack(track)) return;

      noteUserQueueMutation();

      const queueTrack = queueTrackFromFullTrack(track);
      rememberTrack(track);

      if (position === "next") {
        const nextCount = upNextPlayNextCountRef.current + 1;
        upNextPlayNextCountRef.current = nextCount;
        setUpNextPlayNextCount(nextCount);
        setUpNext((prev) => {
          const next = [...prev];
          next.splice(0, 0, queueTrack);
          return next;
        });
        return;
      }

      if (position === "upNext") {
        setUpNext((prev) => [...prev, queueTrack]);
        return;
      }

      setSpine((prev) => [...prev, queueTrack]);
      setSpineOrder((prev) => [...prev, prev.length]);
      setSpineTotal((total) => total + 1);
    },
    [noteUserQueueMutation, rememberTrack],
  );

  const openPlayerWithoutAutoplay = useCallback(() => {
    wantsAutoPlayRef.current = false;
    setIsPlayerVisible(true);
  }, []);

  const isWarmPlayback = isPlayerVisible && currentTrack !== null;

  const removeTrackFromPlaylist = useCallback(
    (target: QueueTarget) => {
      if (target.zone === "upNext") {
        setUpNext((prev) => prev.filter((_, itemIndex) => itemIndex !== target.index));
        if (target.index < upNextPlayNextCount) {
          setUpNextPlayNextCount((count) => {
            const next = Math.max(0, count - 1);
            upNextPlayNextCountRef.current = next;
            return next;
          });
        }
        return;
      }

      const orderIndex = target.index;
      if (orderIndex < 0 || orderIndex >= spineOrder.length) return;

      const spineIndexToRemove = spineOrder[orderIndex];
      if (spineIndexToRemove === undefined) return;

      setSpine((prev) => prev.filter((_, itemIndex) => itemIndex !== spineIndexToRemove));
      setSpineOrder((prev) =>
        prev
          .filter((_, itemIndex) => itemIndex !== orderIndex)
          .map((spineIndex) => (spineIndex > spineIndexToRemove ? spineIndex - 1 : spineIndex)),
      );
      setSpineTotal((total) => Math.max(0, total - 1));

      if (orderIndex < spinePosition) {
        setSpinePosition((position) => Math.max(0, position - 1));
      } else if (orderIndex === spinePosition) {
        const nextState = advanceAfterPlay(navigationState, {
          zone: "spine",
          index: Math.min(spinePosition, spineOrder.length - 2),
        });
        const nextTrack = getTrackAtTarget(nextState, {
          zone: "spine",
          index: nextState.spinePosition,
        });
        if (nextTrack) {
          void playResolvedTrack(nextTrack);
        } else {
          setCurrentTrack(null);
        }
      }
    },
    [navigationState, playResolvedTrack, spineOrder, spinePosition, upNextPlayNextCount],
  );

  const removeCurrentFromQueue = useCallback(() => {
    if (!currentTrack) return;

    const upNextIndex = upNext.findIndex((track) => track.id === currentTrack.id);
    if (upNextIndex >= 0) {
      removeTrackFromPlaylist({ zone: "upNext", index: upNextIndex });
      return;
    }

    if (findSpinePositionForTrackId(navigationState, currentTrack.id) === spinePosition) {
      removeTrackFromPlaylist({ zone: "spine", index: spinePosition });
      return;
    }

    const nextTarget = resolveNextTrack(navigationState);
    if (nextTarget) {
      const queueTrack = getTrackAtTarget(navigationState, nextTarget);
      if (!queueTrack) return;

      const nextState = advanceAfterPlay(navigationState, nextTarget);
      setUpNext(nextState.upNext);
      if (nextTarget.zone === "upNext" && nextTarget.index < upNextPlayNextCount) {
        setUpNextPlayNextCount((count) => {
          const next = Math.max(0, count - 1);
          upNextPlayNextCountRef.current = next;
          return next;
        });
      }
      setSpinePosition(nextState.spinePosition);
      void playResolvedTrack(queueTrack);
      return;
    }

    setCurrentTrack(null);
  }, [
    currentTrack,
    navigationState,
    playResolvedTrack,
    removeTrackFromPlaylist,
    spinePosition,
    upNext,
    upNextPlayNextCount,
  ]);

  const playNextTrack = useCallback(
    (track: Track) => {
      if (!isPlayableTrack(track)) return;

      noteUserQueueMutation();

      const activeQueueSession =
        isPlayerVisible &&
        (currentTrack !== null ||
          upNext.length > 0 ||
          getTrackAtTarget(navigationState, { zone: "spine", index: spinePosition }) !== null);

      if (activeQueueSession) {
        addTrackToPlaylist(track, "next");
        return;
      }

      rememberTrack(track);
      wantsAutoPlayRef.current = false;
      setCurrentTrack(track);
      setIsPlayerVisible(true);
    },
    [
      addTrackToPlaylist,
      currentTrack,
      isPlayerVisible,
      navigationState,
      noteUserQueueMutation,
      rememberTrack,
      spinePosition,
      upNext.length,
    ],
  );

  const addToUpNext = useCallback(
    (track: Track) => {
      if (!isPlayableTrack(track)) return;

      addTrackToPlaylist(track, "upNext");

      if (!isWarmPlayback) {
        openPlayerWithoutAutoplay();
      }
    },
    [addTrackToPlaylist, isWarmPlayback, openPlayerWithoutAutoplay],
  );

  const addToQueue = useCallback(
    (track: Track) => {
      if (!isPlayableTrack(track)) return;

      addTrackToPlaylist(track, "end");

      if (!isWarmPlayback) {
        openPlayerWithoutAutoplay();
      }
    },
    [addTrackToPlaylist, isWarmPlayback, openPlayerWithoutAutoplay],
  );

  const addToCurrentPlaylist = useCallback(
    (track: Track) => {
      addToUpNext(track);
    },
    [addToUpNext],
  );

  const advanceToTarget = useCallback(
    (target: QueueTarget) => {
      const queueTrack = getTrackAtTarget(navigationState, target);
      if (!queueTrack) return;

      // Try to get the prefetched URL synchronously. If it exists, we can apply
      // it and call play() within the user gesture, satisfying autoplay policy.
      const cachedUrl = peekCachedPlaybackUrl(queueTrack.id);
      let appliedSynchronously = false;

      if (cachedUrl && unlockAutoplayRef.current) {
        // Apply the prefetched source and play synchronously within the gesture
        appliedSynchronously = unlockAutoplayRef.current(queueTrack.id, cachedUrl);
      }

      if (!appliedSynchronously) {
        // No cached URL or sync application failed - set autoplay intent for async flow
        wantsAutoPlayRef.current = true;
      }

      // Resolve the full track and update queue state. Even if we played synchronously,
      // we still need the full track metadata for the UI.
      void (async () => {
        const fullTrack = await resolvePlayableTrack(queueTrack);
        if (!fullTrack) {
          // Hydration failed - clear autoplay intent
          wantsAutoPlayRef.current = false;
          return;
        }

        const nextState = advanceAfterPlay(navigationState, target);
        setUpNext(nextState.upNext);
        if (target.zone === "upNext" && target.index < upNextPlayNextCount) {
          setUpNextPlayNextCount((count) => {
            const next = Math.max(0, count - 1);
            upNextPlayNextCountRef.current = next;
            return next;
          });
        }
        setSpinePosition(nextState.spinePosition);

        if (!appliedSynchronously) {
          // Async flow - increment token to trigger autoplay effect
          setPlaybackToken((token) => token + 1);
          if (hydrationTimerRef.current) {
            clearTimeout(hydrationTimerRef.current);
            hydrationTimerRef.current = null;
          }
          pendingHydrationIdsRef.current.clear();
        }

        setCurrentTrack(fullTrack);
      })();
    },
    [navigationState, resolvePlayableTrack, upNextPlayNextCount],
  );

  const playNext = useCallback(() => {
    const target = resolveNextTrack(navigationState);
    if (!target) return;
    advanceToTarget(target);
  }, [advanceToTarget, navigationState]);

  /**
   * Jump the queue to a specific track and play it immediately.
   *
   * Spine: advance `spinePosition` to the target, dropping the skipped tracks.
   * Up Next: play the target and drop it plus everything before it, decrementing
   * the "play next" count by however many of those discarded items were play-next.
   * Loop mode is left untouched — `loop="one"` re-applies to the new current track.
   */
  const playQueueTrack = useCallback(
    (target: QueueTarget) => {
      const queueTrack = getTrackAtTarget(navigationState, target);
      if (!queueTrack) return;

      noteUserQueueMutation();

      // Try to get the prefetched URL synchronously. If it exists, we can apply
      // it and call play() within the user gesture, satisfying autoplay policy.
      const cachedUrl = peekCachedPlaybackUrl(queueTrack.id);
      let appliedSynchronously = false;

      if (cachedUrl && unlockAutoplayRef.current) {
        // Apply the prefetched source and play synchronously within the gesture
        appliedSynchronously = unlockAutoplayRef.current(queueTrack.id, cachedUrl);
      }

      if (!appliedSynchronously) {
        // No cached URL or sync application failed - set autoplay intent for async flow
        wantsAutoPlayRef.current = true;
      }

      void (async () => {
        const fullTrack = await resolvePlayableTrack(queueTrack);
        if (!fullTrack) {
          // Hydration failed - clear autoplay intent
          wantsAutoPlayRef.current = false;
          return;
        }

        const nextState = jumpToTarget(navigationState, target);
        setUpNext(nextState.upNext);

        if (target.zone === "upNext") {
          // Discarding 0..target.index drops the clicked track and everything before
          // it. Play-next items sit at the front of Up Next, so decrement the count
          // by however many of them fall inside the discarded range.
          const playNextDiscarded = Math.min(target.index + 1, upNextPlayNextCount);
          if (playNextDiscarded > 0) {
            setUpNextPlayNextCount((count) => {
              const next = Math.max(0, count - playNextDiscarded);
              upNextPlayNextCountRef.current = next;
              return next;
            });
          }
        }

        setSpinePosition(nextState.spinePosition);

        if (!appliedSynchronously) {
          // Async flow - increment token to trigger autoplay effect
          setPlaybackToken((token) => token + 1);
          if (hydrationTimerRef.current) {
            clearTimeout(hydrationTimerRef.current);
            hydrationTimerRef.current = null;
          }
          pendingHydrationIdsRef.current.clear();
        }

        setCurrentTrack(fullTrack);
      })();
    },
    [navigationState, noteUserQueueMutation, resolvePlayableTrack, upNextPlayNextCount],
  );

  const startQueuePlayback = useCallback(() => {
    if (currentTrack) return;

    if (upNext.length > 0) {
      advanceToTarget({ zone: "upNext", index: 0 });
      return;
    }

    const queueTrack = getTrackAtTarget(navigationState, {
      zone: "spine",
      index: spinePosition,
    });
    if (queueTrack) {
      void playResolvedTrack(queueTrack);
    }
  }, [
    advanceToTarget,
    currentTrack,
    navigationState,
    playResolvedTrack,
    spinePosition,
    upNext.length,
  ]);

  const playPrevious = useCallback(() => {
    const target = resolvePreviousTrack(navigationState);
    if (!target) return;

    const queueTrack = getTrackAtTarget(navigationState, target);
    if (!queueTrack) return;

    setSpinePosition(target.index);
    void playResolvedTrack(queueTrack);
  }, [navigationState, playResolvedTrack]);

  const toggleLoop = useCallback(() => {
    setLoopMode((prev) => {
      switch (prev) {
        case "off":
          return "all";
        case "all":
          return "one";
        case "one":
          return "off";
        default:
          return "off";
      }
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    if (shuffleSeed === null) {
      // Shuffle ON: mint a fresh seed and reshuffle from the current position,
      // so the identical permutation can be regenerated on restore.
      const seed = generateShuffleSeed();
      setShuffleSeed(seed);
      setSpineOrder((order) =>
        reshuffleFromCurrent(
          order.length === spine.length ? order : createShuffledOrder(spine.length, false),
          spinePosition,
          seed,
        ),
      );
    } else {
      // Shuffle OFF: restore identity order and drop the seed.
      setShuffleSeed(null);
      const currentSpineIndex = spineOrder[spinePosition];
      const identityOrder = createShuffledOrder(spine.length, false);
      setSpineOrder(identityOrder);
      if (currentSpineIndex !== undefined) {
        setSpinePosition(currentSpineIndex);
      }
    }
  }, [shuffleSeed, spine.length, spineOrder, spinePosition]);

  const closePlayer = useCallback(() => {
    playlistFetchEpochRef.current += 1;
    wantsAutoPlayRef.current = false;
    setIsPlayerVisible(false);
    setCurrentTrack(null);
    resetQueueState();
    setPlayContext(null);
  }, [resetQueueState]);

  const hasQueuedPlayback =
    upNext.length > 0 ||
    getTrackAtTarget(navigationState, { zone: "spine", index: spinePosition }) !== null;
  const hasNext = hasNextTrack(navigationState);
  const hasPrevious = hasPreviousTrack(navigationState);

  const currentTrackId = currentTrack?.id;

  useEffect(() => {
    if (!isPlayerVisible || !currentTrackId || isOfflineEnvironment()) return;
    if (!isQueueCacheEnabled(userId ?? "")) return;

    const storage = getOfflineStorage();

    void (async () => {
      try {
        await hydrateAround(currentTrackId);
      } catch (error) {
        console.warn("Queue auto-cache hydration failed:", error);
        return;
      }
      const ids = collectHydrationIds(navigationState, currentTrackId);

      for (const id of ids) {
        const queueTrack = playbackCacheRef.current.get(id);
        if (!queueTrack || !isPlayableTrack(queueTrack)) continue;
        try {
          await storage.cacheQueueTrack(queueTrack);
        } catch (error) {
          console.warn("Queue auto-cache failed:", error);
        }
      }
    })();
  }, [currentTrackId, hydrateAround, isPlayerVisible, navigationState, userId]);

  const restoreQueueFromServerRef = useRef<((saved: PlayerStateData) => Promise<void>) | null>(
    null,
  );

  const suspendPersonalPersistence = useCallback(() => {
    persistenceSuspendedRef.current = true;
  }, []);

  const resumePersonalPersistence = useCallback(() => {
    persistenceSuspendedRef.current = false;
    setRoomSpeaker(null);
    setRoomPlaying(null);
    roomOnEndedRef.current = null;
  }, []);

  const getPersonalPlayerSnapshot = useCallback((): PlayerStateData => {
    return { ...playerStateRef.current };
  }, []);

  const restorePersonalPlayerSnapshot = useCallback(
    async (snapshot: PlayerStateData, wasVisible: boolean) => {
      setRoomSpeaker(null);
      roomOnEndedRef.current = null;
      if (!wasVisible || !hasPersistableQueue(snapshot)) {
        closePlayer();
        return;
      }
      await restoreQueueFromServerRef.current?.(snapshot);
    },
    [closePlayer],
  );

  const playRoomSpeakerTrack = useCallback(
    (track: Track, options: { roomId: string; code: string; onEnded?: () => void }) => {
      setRoomSpeaker({ roomId: options.roomId, code: options.code });
      roomOnEndedRef.current = options.onEnded ?? null;
      wantsAutoPlayRef.current = true;
      setCurrentTrack(track);
      setIsPlayerVisible(true);
      setPlaybackToken((token) => token + 1);
      setUpNext([]);
      setSpine([]);
      setSpineOrder([]);
      setSpinePosition(0);
      setSpineTotal(0);
      setPlayContext(null);
    },
    [],
  );

  const setRoomPlaybackPlaying = useCallback((playing: boolean) => {
    setRoomPlaying(playing);
  }, []);

  const handleRoomSpeakerEnded = useCallback(() => {
    roomOnEndedRef.current?.();
  }, []);

  const contextValue = useMemo(
    () => ({
      currentTrack,
      isPlayerVisible,
      playlist,
      upNext: upNextView,
      spine: spineView,
      spineTotal,
      spinePosition,
      currentIndex,
      playContext,
      loopMode,
      isShuffleEnabled,
      playTrack,
      playPlaylist,
      playLibrary,
      playUserPlaylist,
      playNext,
      playPrevious,
      toggleLoop,
      toggleShuffle,
      closePlayer,
      startQueuePlayback,
      hasQueuedPlayback,
      hasNext,
      hasPrevious,
      isLoadingNext,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      removeCurrentFromQueue,
      playNextTrack,
      addToUpNext,
      addToQueue,
      playQueueTrack,
      hydrateTracksForDisplay,
      addToCurrentPlaylist,
      suspendPersonalPersistence,
      resumePersonalPersistence,
      getPersonalPlayerSnapshot,
      restorePersonalPlayerSnapshot,
      playRoomSpeakerTrack,
      setRoomPlaybackPlaying,
      roomSpeaker,
    }),
    [
      currentTrack,
      isPlayerVisible,
      playlist,
      upNextView,
      spineView,
      spineTotal,
      spinePosition,
      currentIndex,
      playContext,
      loopMode,
      isShuffleEnabled,
      playTrack,
      playPlaylist,
      playLibrary,
      playUserPlaylist,
      playNext,
      playPrevious,
      toggleLoop,
      toggleShuffle,
      closePlayer,
      startQueuePlayback,
      hasQueuedPlayback,
      hasNext,
      hasPrevious,
      isLoadingNext,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      removeCurrentFromQueue,
      playNextTrack,
      addToUpNext,
      addToQueue,
      playQueueTrack,
      hydrateTracksForDisplay,
      addToCurrentPlaylist,
      suspendPersonalPersistence,
      resumePersonalPersistence,
      getPersonalPlayerSnapshot,
      restorePersonalPlayerSnapshot,
      playRoomSpeakerTrack,
      setRoomPlaybackPlaying,
      roomSpeaker,
    ],
  );

  // Prefetch the next track's presigned URL while the current one plays so the
  // auto-advance transition needs no network round-trip. On a locked screen the
  // page is hidden and background fetches are throttled, so resolving the URL
  // at transition time is what makes the next track stall/silent.
  useEffect(() => {
    if (!currentTrackId || isOfflineEnvironment()) return;
    const nextTarget = resolveNextTrack(navigationState);
    if (!nextTarget) return;
    const nextQueueTrack = getTrackAtTarget(navigationState, nextTarget);
    if (nextQueueTrack) {
      prefetchPlaybackAudioUrl(nextQueueTrack.id);
    }
  }, [currentTrackId, navigationState]);

  // Rebuild the restored queue from a saved `PlayerState`: re-derive the spine
  // from the play context, replay Up Next + position on top, and leave the
  // player paused (restore-and-wait — no autoplay).
  const restoreQueueFromServer = useCallback(
    async (saved: PlayerStateData) => {
      const epoch = restoreEpochRef.current;
      const shouldAbortRestore = () =>
        userMutatedQueueRef.current || epoch !== restoreEpochRef.current;

      if (shouldAbortRestore()) return;

      const context = playlistContextFromJson(saved.playContext);

      // Resolve the current track + Up Next ids to full tracks via the playback
      // batch endpoint, which enforces the user's library access and therefore
      // drops tracks removed since the last session.
      const idsToResolve = [
        ...(saved.currentTrackId ? [saved.currentTrackId] : []),
        ...saved.upNextIds,
      ];
      let resolvedTracks: FullTrack[] = [];
      if (idsToResolve.length > 0) {
        try {
          resolvedTracks = await fetchPlaybackBatch(idsToResolve);
        } catch (error) {
          console.error("Failed to resolve player state tracks:", error);
          resolvedTracks = [];
        }
      }
      if (shouldAbortRestore()) return;

      const byId = new Map(resolvedTracks.map((track) => [track.id, track]));
      for (const track of resolvedTracks) {
        playbackCacheRef.current.set(track);
      }

      // Re-derive the spine from the play context (never snapshotted).
      let spineTracks: QueueTrack[] = [];
      let total = 0;
      if (context) {
        const loaded = await loadSpineForContext(context);
        spineTracks = loaded.tracks;
        total = loaded.total;
      }
      if (shouldAbortRestore()) return;

      const resolvedUpNext = saved.upNextIds
        .map((id) => byId.get(id))
        .filter((track): track is FullTrack => track !== undefined)
        .map(queueTrackFromFullTrack);

      const order = createShuffledOrder(
        spineTracks.length,
        saved.shuffleSeed !== null,
        saved.shuffleSeed ?? undefined,
      );

      // Claim the queue before writing so a concurrent offline restore cannot
      // apply a truncated snapshot after these setStates.
      onlineRestoreAppliedRef.current = true;

      setPlayContext(context);
      setLoopMode(saved.loopMode);
      setShuffleSeed(saved.shuffleSeed);
      setUpNext(resolvedUpNext);
      setUpNextPlayNextCount(0);
      upNextPlayNextCountRef.current = 0;
      setSpine(spineTracks);
      setSpineTotal(total);
      setSpineOrder(order);

      const currentFullTrack = saved.currentTrackId
        ? (byId.get(saved.currentTrackId) ?? null)
        : null;

      if (currentFullTrack && isPlayableTrack(currentFullTrack)) {
        // Position the current track within the reconstructed play order; a null
        // position means it lives in Up Next (or nowhere), in which case the
        // spine keeps its default position.
        const position = findSpinePositionForTrackId(
          {
            upNext: resolvedUpNext,
            spine: spineTracks,
            spineOrder: order,
            spinePosition: 0,
            loopMode: saved.loopMode,
          },
          currentFullTrack.id,
        );
        if (position !== null) setSpinePosition(position);

        setCurrentTrack(currentFullTrack);
        setCacheVersion((version) => version + 1);
      }

      // Restore-and-wait: show the player paused, never auto-play.
      wantsAutoPlayRef.current = false;
      if (currentFullTrack || resolvedUpNext.length > 0 || spineTracks.length > 0) {
        setIsPlayerVisible(true);
      }
    },
    [loadSpineForContext],
  );

  restoreQueueFromServerRef.current = restoreQueueFromServer;

  // Offline partial restore: rebuild the current track + Up Next from the
  // locally mirrored player state, resolving only tracks that are downloaded
  // for offline playback. The spine is intentionally NOT re-derived (no network
  // round-trips); it backfills via a full online restore once the network
  // returns. A client-side spine snapshot is never cached.
  const restoreQueueOffline = useCallback(async (restoreUserId: string) => {
    const epoch = restoreEpochRef.current;
    const saved = readCachedPlayerState(restoreUserId);
    if (!saved) return;
    if (userMutatedQueueRef.current || epoch !== restoreEpochRef.current) return;

    const storage = getOfflineStorage();
    const downloaded = await storage.listDownloaded();
    if (userMutatedQueueRef.current || epoch !== restoreEpochRef.current) return;
    const byId = new Map(downloaded.map((summary) => [summary.trackId, summary]));

    const toFullTrack = (id: string): FullTrack | null => {
      const summary = byId.get(id);
      return summary ? offlineSummaryToFullTrack(summary) : null;
    };

    const currentFullTrack = saved.currentTrackId ? toFullTrack(saved.currentTrackId) : null;
    const resolvedUpNext = saved.upNextIds
      .map(toFullTrack)
      .filter((track): track is FullTrack => track !== null);

    for (const track of [currentFullTrack, ...resolvedUpNext]) {
      if (track) playbackCacheRef.current.set(track);
    }

    // Online restore already applied the full queue (or persist is unlocked
    // after a successful fetch). Applying now would drop undownloaded Up Next
    // ids and wipe the backfilled spine.
    if (onlineRestoreAppliedRef.current || onlineRestoreDoneRef.current) return;

    setCacheVersion((version) => version + 1);

    setPlayContext(playlistContextFromJson(saved.playContext));
    setLoopMode(saved.loopMode);
    setShuffleSeed(saved.shuffleSeed);
    setUpNext(resolvedUpNext.map(queueTrackFromFullTrack));
    setUpNextPlayNextCount(0);
    upNextPlayNextCountRef.current = 0;
    // No spine offline — leave it empty and backfill on reconnect.
    setSpine([]);
    setSpineTotal(0);
    setSpineOrder([]);
    setSpinePosition(0);

    if (currentFullTrack && isPlayableTrack(currentFullTrack)) {
      setCurrentTrack(currentFullTrack);
    }

    // Restore-and-wait: show the player paused, never auto-play.
    wantsAutoPlayRef.current = false;
    if (currentFullTrack || resolvedUpNext.length > 0) {
      setIsPlayerVisible(true);
    }
  }, []);

  // Keep the serializable-state mirror in sync for the debounced write + flush.
  useEffect(() => {
    playerStateRef.current = {
      playContext: playContextToJson(playContext),
      currentTrackId: currentTrack?.id ?? null,
      upNextIds: upNext.map((track) => track.id),
      shuffleSeed,
      loopMode,
    };
  }, [playContext, currentTrack?.id, upNext, shuffleSeed, loopMode]);

  // Debounced write: ~1s after the last queue mutation. Gated so the initial
  // empty snapshot, a previous user's queue, or an offline-truncated Up Next
  // can never overwrite the saved row. A user-started queue may persist even
  // when the online restore GET failed — otherwise the session is silently lost.
  useEffect(() => {
    if (
      !userId ||
      persistenceSuspendedRef.current ||
      !shouldPersistPlayerState(
        userId,
        onlineRestoredForUserIdRef.current,
        userMutatedQueueRef.current,
        playerStateRef.current,
      )
    ) {
      return;
    }

    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      if (
        persistenceSuspendedRef.current ||
        !shouldPersistPlayerState(
          userId,
          onlineRestoredForUserIdRef.current,
          userMutatedQueueRef.current,
          playerStateRef.current,
        )
      ) {
        return;
      }
      writeCachedPlayerState(userId, playerStateRef.current);
      persistPlayerState(playerStateRef.current);
    }, 1000);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [
    userId,
    playContext,
    currentTrack?.id,
    upNext,
    shuffleSeed,
    loopMode,
    persistEpoch,
    roomSpeaker,
  ]);

  // Flush on page unload so the latest state survives a tab close / navigation.
  useEffect(() => {
    if (!userId) return;

    const flush = () => {
      if (
        persistenceSuspendedRef.current ||
        !shouldPersistPlayerState(
          userId,
          onlineRestoredForUserIdRef.current,
          userMutatedQueueRef.current,
          playerStateRef.current,
        )
      ) {
        return;
      }
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      writeCachedPlayerState(userId, playerStateRef.current);
      persistPlayerState(playerStateRef.current, { keepalive: true });
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [userId]);

  // Online full restore: fetch the saved queue from the server and re-derive the
  // spine. Runs once per sign-in when the network is available — on initial load
  // and again as a backfill when the network returns after an offline partial
  // restore.
  useEffect(() => {
    if (!userId || !isOnline || onlineRestoreDoneRef.current) return;

    const epoch = restoreEpochRef.current;
    void (async () => {
      try {
        const saved = await fetchPlayerState();
        if (epoch !== restoreEpochRef.current) return;
        if (saved && !userMutatedQueueRef.current) {
          await restoreQueueFromServer(saved);
        }
        if (epoch !== restoreEpochRef.current) return;
        onlineRestoreDoneRef.current = true;
        onlineRestoredForUserIdRef.current = userId;
        setPersistEpoch((value) => value + 1);
      } catch (error) {
        if (epoch === restoreEpochRef.current) {
          console.error("Failed to restore player state:", error);
        }
      }
    })();
  }, [userId, isOnline, restoreQueueFromServer]);

  // Offline partial restore: rebuild the current track + Up Next from the local
  // mirror *if those tracks are downloaded*, without any spine fetch. Runs at
  // most once, only when the app loads offline (a full online restore has not
  // yet happened).
  useEffect(() => {
    if (
      !userId ||
      isOnline ||
      offlineRestoreDoneRef.current ||
      onlineRestoreDoneRef.current ||
      onlineRestoreAppliedRef.current
    ) {
      return;
    }

    const epoch = restoreEpochRef.current;
    offlineRestoreDoneRef.current = true;
    void (async () => {
      try {
        await restoreQueueOffline(userId);
      } catch (error) {
        if (epoch === restoreEpochRef.current) {
          console.error("Failed to restore player state offline:", error);
        }
      }
    })();
  }, [userId, isOnline, restoreQueueOffline]);

  return (
    <AudioPlayerContext.Provider value={contextValue}>
      {children}
      <InstallAppBanner playerVisible={isPlayerVisible} />
      <AudioPlayer
        track={currentTrack}
        isVisible={isPlayerVisible}
        onClose={closePlayer}
        onStartQueuePlayback={startQueuePlayback}
        hasQueuedPlayback={hasQueuedPlayback}
        onNext={roomSpeaker ? handleRoomSpeakerEnded : playNext}
        onPrevious={roomSpeaker ? () => {} : playPrevious}
        onToggleLoop={toggleLoop}
        onToggleShuffle={toggleShuffle}
        hasNext={roomSpeaker ? true : hasNext}
        hasPrevious={roomSpeaker ? false : hasPrevious}
        loopMode={roomSpeaker ? "off" : loopMode}
        isShuffleEnabled={roomSpeaker ? false : isShuffleEnabled}
        playbackToken={playbackToken}
        wantsAutoPlayRef={wantsAutoPlayRef}
        unlockAutoplayRef={unlockAutoplayRef}
        roomSpeaker={roomSpeaker}
        roomPlaying={roomPlaying}
        audioSrcOverride={
          roomSpeaker && currentTrack ? `/resources/rooms/audio/${currentTrack.id}` : undefined
        }
      />
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext);
  if (context === undefined) {
    throw new Error("useAudioPlayer must be used within an AudioPlayerProvider");
  }
  return context;
}
