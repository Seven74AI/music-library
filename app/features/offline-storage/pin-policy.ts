import { type OfflineTrackRecord } from "./types.ts";

export function isProtectedOfflineTrack(track: OfflineTrackRecord): boolean {
  return track.isPinned;
}

export function selectQueueCacheEvictionCandidates(
  tracks: OfflineTrackRecord[],
  bytesToFree: number,
): OfflineTrackRecord[] {
  const evictable = tracks
    .filter((track) => track.isQueueCached && !track.isPinned)
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  const selected: OfflineTrackRecord[] = [];
  let freed = 0;

  for (const track of evictable) {
    if (freed >= bytesToFree) break;
    selected.push(track);
    freed += track.fileSizeBytes;
  }

  return selected;
}

export function shouldRemoveRecordAfterEviction(track: OfflineTrackRecord): boolean {
  return !track.isPinned && track.isQueueCached;
}
