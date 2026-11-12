/**
 * Existing track row subset used during sync identity planning.
 */
export type ExistingTrackForPlan = {
  id: string;
  title: string;
  artistId: string;
  coverImageId: string | null;
  externalId: string | null;
};

export type TrackIdentityPlan<TTrack extends ExistingTrackForPlan = ExistingTrackForPlan> =
  | { kind: "process"; externalId: string; existingTrack: TTrack | null }
  | { kind: "defer"; externalId: string }
  | { kind: "skip"; reason: string };

export type PlanUnavailableItemInput<TTrack extends ExistingTrackForPlan = ExistingTrackForPlan> = {
  isUnavailable: boolean;
  itemId: string | undefined;
  videoId: string;
  playlistId: string;
  position: number;
  existingTrack: TTrack | null;
};

/** Playlist-scoped synthetic ids used for unavailable / placeholder rows during sync. */
export function isSyntheticUnavailableExternalIdForPlaylist(
  externalId: string | null | undefined,
  playlistId: string,
): boolean {
  if (!externalId) return false;
  return (
    externalId.startsWith(`pending-${playlistId}-`) ||
    externalId.startsWith(`deleted-${playlistId}-`)
  );
}

/**
 * Decide how to handle a playlist item after DB lookups for existing tracks.
 * Owns externalId synthesis and defer vs process vs skip — not the DB lookups themselves.
 */
export function planUnavailableItemProcessing<TTrack extends ExistingTrackForPlan>(
  input: PlanUnavailableItemInput<TTrack>,
): TrackIdentityPlan<TTrack> {
  const { isUnavailable, itemId, videoId, playlistId, position, existingTrack } = input;

  if (isUnavailable && !existingTrack) {
    const externalId = itemId || `pending-${playlistId}-${position}`;
    return { kind: "defer", externalId };
  }

  let externalId = videoId;
  if (isUnavailable && !externalId) {
    externalId = itemId || existingTrack?.externalId || `deleted-${playlistId}-${position}`;
  }

  if (!externalId || externalId.trim() === "") {
    return { kind: "skip", reason: "missing externalId" };
  }

  return {
    kind: "process",
    externalId,
    existingTrack,
  };
}
