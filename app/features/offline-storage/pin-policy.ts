import { type OfflineTrackRecord } from "./types.ts";

type OfflinePinFlags = Pick<OfflineTrackRecord, "isPinned" | "isQueueCached">;

/** Queue Cache only — not a Pinned Download. Eligible for LRU eviction and purge. */
export function isQueueOnlyOfflineTrack(track: OfflinePinFlags): boolean {
  return track.isQueueCached && !track.isPinned;
}

export function getOfflineStorageKind(
  track: OfflinePinFlags,
): "downloaded" | "auto-cached" | null {
  if (track.isPinned) return "downloaded";
  if (track.isQueueCached) return "auto-cached";
  return null;
}

export function selectQueueCacheEvictionCandidates(
  tracks: OfflineTrackRecord[],
  bytesToFree: number,
): OfflineTrackRecord[] {
  const evictable = tracks
    .filter(isQueueOnlyOfflineTrack)
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
