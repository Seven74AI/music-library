import { type OfflineTrackSummary } from "#app/features/offline-storage/types.ts";

/**
 * Map an {@link OfflineTrackSummary} to the shape `TrackListItem` expects.
 * Shared by the offline library and playlist views so the adapter stays in one
 * place instead of drifting across two near-identical copies.
 */
export function toOfflineTrackListItemTrack(track: OfflineTrackSummary) {
  return {
    id: track.trackId,
    title: track.title,
    artist: { id: track.artistId, name: track.artistName },
    duration: track.duration,
    coverImage: track.coverObjectKey ? { objectKey: track.coverObjectKey } : null,
    serviceUrl: null,
    audioFiles: [{ id: track.trackId, format: "mp3" as const, objectKey: "" }],
  };
}
