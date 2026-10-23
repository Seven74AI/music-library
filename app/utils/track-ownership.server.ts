/**
 * Shared track-ownership access rules for the audio serving routes.
 *
 * `audio.$trackId.tsx` (stream) and `audio.$trackId.download-url.tsx` (download)
 * both load a track and gate it behind the same three-way ownership check: the
 * caller must own the track via their library, a user-owned active service
 * playlist, or a user playlist. Keeping the include fragment and the
 * deny-by-default check in one module prevents the two routes from drifting on
 * access-rule changes.
 */

/**
 * The three-way ownership include fragment. Spread into a `prisma.track`
 * `include` (alongside whatever audio/artist fields the caller needs).
 */
export function trackOwnershipAccessInclude(userId: string) {
  return {
    userTracks: {
      where: { userId, isActive: true, deletedAt: null },
      select: { id: true },
    },
    servicePlaylistTracks: {
      where: {
        isDeleted: false,
        deletedAt: null,
        playlist: { ownerId: userId, isActive: true },
      },
      take: 1,
    },
    playlists: {
      where: {
        playlist: { ownerId: userId },
      },
      take: 1,
    },
  };
}

/**
 * Deny-by-default access check for a track loaded with
 * {@link trackOwnershipAccessInclude}. Throws a 403 when the caller has no
 * ownership stake in the track.
 */
export function assertTrackAccessOrThrow(track: {
  userTracks: readonly unknown[];
  servicePlaylistTracks: readonly unknown[];
  playlists: readonly unknown[];
}): void {
  if (
    track.userTracks.length === 0 &&
    track.servicePlaylistTracks.length === 0 &&
    track.playlists.length === 0
  ) {
    throw new Response("Access denied", { status: 403 });
  }
}
