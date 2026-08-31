import { type LoopMode } from "#app/features/queue/queue-navigation.ts";

/**
 * Persisted play context — the subset of the client `PlaylistContext` needed to
 * re-derive a queue spine on restore. `cursor` (a pagination cursor) and the
 * unused `music` context are intentionally dropped: they do not reconstruct a
 * spine and only add staleness.
 */
export type PlayContextJson =
  | { type: "library" }
  | { type: "playlist"; playlistId: string }
  | { type: "artist"; artistId: string }
  | { type: "album"; albumId: string }
  | { type: "track"; trackId: string };

/** Serializable player state, as stored in the `PlayerState` row and sent over the wire. */
export type PlayerStateData = {
  playContext: PlayContextJson | null;
  currentTrackId: string | null;
  upNextIds: string[];
  shuffleSeed: number | null;
  loopMode: LoopMode;
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

  return response.json() as Promise<PlayerStateData>;
}

/**
 * Persist the queue to the server. Fire-and-forget: persistence must never
 * break playback. `keepalive` is for the `beforeunload` flush so the request
 * survives page teardown.
 */
export function persistPlayerState(data: PlayerStateData, options?: { keepalive?: boolean }): void {
  if (typeof window === "undefined") return;

  void fetch(PLAYER_STATE_ROUTE, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "same-origin",
    keepalive: options?.keepalive ?? false,
  }).catch(() => {
    // Network errors during persistence must not interrupt playback.
  });
}
