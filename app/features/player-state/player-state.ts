import {
  findSpinePositionForTrackId,
  type LoopMode,
  type QueueNavigationState,
  type QueueZone,
} from "#app/features/queue/queue-navigation.ts";
import { type DiscoverSortOption } from "#app/utils/discover.ts";

/**
 * Persisted play context — the subset of the client `PlaylistContext` needed to
 * re-derive a queue spine on restore. `cursor` (a pagination cursor) and the
 * unused `music` context are intentionally dropped: they do not reconstruct a
 * spine and only add staleness.
 */
export type PlayContextJson =
  | {
      type: "library";
      /** Omitted or `dateAdded` means newest-added library order. */
      sort?: "dateAdded" | "mostPlayedMonth" | "mostPlayedEver";
      /** Omitted means the default direction for the chosen sort (desc). */
      direction?: "asc" | "desc";
    }
  | {
      type: "playlist";
      playlistId: string;
      /** Omitted or `custom` means playlist position order. */
      sort?: "custom" | "title" | "artist" | "duration" | "dateAdded";
      /** Omitted means the default direction for the chosen sort. */
      direction?: "asc" | "desc";
    }
  | { type: "artist"; artistId: string }
  | { type: "album"; albumId: string }
  | { type: "track"; trackId: string }
  | { type: "onRepeatSnapshot"; snapshotId: string }
  | {
      type: "discover";
      /** Omitted means recently added. */
      sort?: DiscoverSortOption;
      /** Omitted means the default direction for the chosen sort. */
      direction?: "asc" | "desc";
    };

/** Serializable player state, as stored in the `PlayerState` row and sent over the wire. */
export type PlayerStateData = {
  playContext: PlayContextJson | null;
  currentTrackId: string | null;
  upNextIds: string[];
  shuffleSeed: number | null;
  loopMode: LoopMode;
  /** Spine order index when the audible track is from the spine (or the frozen spine head while Up Next plays). */
  spinePosition?: number;
  audibleSourceZone?: QueueZone | null;
  upNextPlayNextCount?: number;
};

export const PLAYER_STATE_ROUTE = "/resources/player-state";

/** Read the authenticated user's saved queue. Resolves `null` when none exists. */
export async function fetchPlayerState(): Promise<PlayerStateData | null> {
  const response = await fetch(PLAYER_STATE_ROUTE, {
    method: "GET",
    credentials: "same-origin",
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch player state: ${response.status}`);
  }

  const data = (await response.json()) as PlayerStateData;
  return withPlayerStateDefaults(data) as PlayerStateData;
}

export type ResolvedPlayerStateData = PlayerStateData & {
  spinePosition: number;
  audibleSourceZone: QueueZone | null;
  upNextPlayNextCount: number;
};

/** True when persisted queue data does not record which zone is audible (legacy or migrated). */
export function isAudibleSourceZoneUnknown(zone: QueueZone | null | undefined): boolean {
  return zone === null || zone === undefined;
}

export type InferredAudibleSource = {
  audibleSourceZone: QueueZone | null;
  spinePosition: number;
};

function clampSpinePosition(position: number, spineOrderLength: number): number {
  if (spineOrderLength <= 0) return 0;
  return Math.min(Math.max(0, position), spineOrderLength - 1);
}

/** Adjust play-next prefix length after Up Next ids are filtered on queue restore. */
export function clampUpNextPlayNextCountOnRestore(
  savedUpNextIds: readonly string[],
  resolvedUpNextIds: readonly string[],
  savedPlayNextCount: number,
): number {
  const resolved = new Set(resolvedUpNextIds);
  const prefixEnd = Math.min(savedPlayNextCount, savedUpNextIds.length);
  let droppedInPrefix = 0;
  for (let index = 0; index < prefixEnd; index++) {
    if (!resolved.has(savedUpNextIds[index]!)) {
      droppedInPrefix += 1;
    }
  }
  const adjusted = savedPlayNextCount - droppedInPrefix;
  return Math.min(Math.max(0, adjusted), resolvedUpNextIds.length);
}

/** Re-derive zone + spine position once a spine exists for migrated/legacy rows. */
export function inferAudibleSourceForRestore(
  zoneUnknown: boolean,
  knownZone: QueueZone | null,
  savedSpinePosition: number,
  navigation: QueueNavigationState,
  currentTrackId: string,
  upNextTrackIds: string[],
): InferredAudibleSource {
  const clampedSaved = clampSpinePosition(savedSpinePosition, navigation.spineOrder.length);

  if (knownZone === "upNext" && !zoneUnknown) {
    return { audibleSourceZone: "upNext", spinePosition: clampedSaved };
  }

  if (!zoneUnknown && knownZone === "spine") {
    const position = findSpinePositionForTrackId(navigation, currentTrackId);
    const spinePosition =
      position !== null ? clampSpinePosition(position, navigation.spineOrder.length) : clampedSaved;
    return { audibleSourceZone: "spine", spinePosition };
  }

  if (zoneUnknown) {
    const position = findSpinePositionForTrackId(navigation, currentTrackId);
    if (position !== null) {
      return {
        audibleSourceZone: "spine",
        spinePosition: clampSpinePosition(position, navigation.spineOrder.length),
      };
    }
    if (upNextTrackIds.includes(currentTrackId)) {
      return { audibleSourceZone: "upNext", spinePosition: clampedSaved };
    }
    return { audibleSourceZone: null, spinePosition: clampedSaved };
  }

  return { audibleSourceZone: knownZone, spinePosition: clampedSaved };
}

/** Apply defaults for queue-position fields omitted by older persisted rows. */
export function withPlayerStateDefaults(data: PlayerStateData): ResolvedPlayerStateData {
  return {
    ...data,
    spinePosition: data.spinePosition ?? 0,
    audibleSourceZone: data.audibleSourceZone ?? null,
    upNextPlayNextCount: data.upNextPlayNextCount ?? 0,
  };
}

/**
 * Persist the queue to the server. Fire-and-forget: persistence must never
 * break playback. `keepalive` is for the `beforeunload` flush so the request
 * survives page teardown.
 */
export function persistPlayerState(data: PlayerStateData, options?: { keepalive?: boolean }): void {
  if (typeof window === "undefined") return;

  void Promise.resolve(
    fetch(PLAYER_STATE_ROUTE, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      credentials: "same-origin",
      keepalive: options?.keepalive ?? false,
    }),
  ).catch(() => {
    // Network errors during persistence must not interrupt playback.
  });
}
