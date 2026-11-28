import { type OfflineTrackSummary } from "./types.ts";

export type PlaylistDownloadStatus = {
  total: number;
  downloadedIds: Set<string>;
  missingIds: Set<string>;
  isComplete: boolean;
  isPartial: boolean;
};

/**
 * Compares the playlist's current playable track ids against the summaries
 * already stored for that playlist. Only pinned summaries count as downloaded;
 * summaries for tracks no longer in the playlist are ignored.
 */
export function computePlaylistDownloadStatus(
  playableTrackIds: string[],
  playlistSummaries: OfflineTrackSummary[],
): PlaylistDownloadStatus {
  const pinned = new Set(
    playlistSummaries.filter((summary) => summary.isPinned).map((summary) => summary.trackId),
  );
  const downloadedIds = new Set<string>();
  const missingIds = new Set<string>();
  for (const id of new Set(playableTrackIds)) {
    if (pinned.has(id)) downloadedIds.add(id);
    else missingIds.add(id);
  }
  const total = downloadedIds.size + missingIds.size;
  return {
    total,
    downloadedIds,
    missingIds,
    isComplete: total > 0 && missingIds.size === 0,
    isPartial: downloadedIds.size > 0 && missingIds.size > 0,
  };
}
