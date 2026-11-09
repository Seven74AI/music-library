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

/** Re-derive zone + spine position once a spine exists for migrated/legacy rows. */
export function inferAudibleSourceForRestore(
  zoneUnknown: boolean,
  knownZone: QueueZone | null,
  savedSpinePosition: number,
  navigation: QueueNavigationState,
  currentTrackId: string,
  upNextTrackIds: string[],
): InferredAudibleSource {
  if (!zoneUnknown) {
    return { audibleSourceZone: knownZone, spinePosition: savedSpinePosition };
  }

  const position = findSpinePositionForTrackId(navigation, currentTrackId);
  if (position !== null) {
    return { audibleSourceZone: "spine", spinePosition: position };
  }
  if (upNextTrackIds.includes(currentTrackId)) {
    return { audibleSourceZone: "upNext", spinePosition: savedSpinePosition };
  }
  return { audibleSourceZone: null, spinePosition: savedSpinePosition };
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
