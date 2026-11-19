/**
 * Single source of truth for "a track in a shared playlist is accessible to any
 * logged-in user" (ADR-045). Reused by the audio routes (track-ownership), the
 * queue access predicate (queue-playback) and the queue spine (queue-spine).
 *
 * UNLISTED protects discovery, not access: PUBLIC and UNLISTED playlists both
 * grant stream/download to every logged-in caller, with no owner filter.
 */
export const SHARED_PLAYLIST_VISIBILITIES = ["PUBLIC", "UNLISTED"] as const;

/** `UserPlaylist` where-fragment: playlists any logged-in user may read/play. */
export const sharedPlaylistWhere = {
  visibility: { in: [...SHARED_PLAYLIST_VISIBILITIES] },
};

/** `UserPlaylist` where-fragment: owned by `userId`, or shared. */
export function ownedOrSharedPlaylistWhere(userId: string) {
  return { OR: [{ ownerId: userId }, sharedPlaylistWhere] };
}
