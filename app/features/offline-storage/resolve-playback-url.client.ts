import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";

const blobUrlCache = new Map<string, string>();

// Presigned remote URLs are cached so the next track can be prefetched while
// the current one plays. This keeps the auto-advance transition off the
// network (critical on lock screens, where background fetches are throttled).
const remoteUrlCache = new Map<string, string>();
const pendingRemoteFetches = new Set<string>();

export class OfflineDataCorruptedError extends Error {
  constructor(message = "Offline data is corrupted or unavailable") {
    super(message);
    this.name = "OfflineDataCorruptedError";
  }
}

export async function resolvePlaybackAudioUrl(trackId: string): Promise<string | null> {
  const storage = getOfflineStorage();
  try {
    const blob = await storage.resolvePlaybackBlob(trackId);
    if (!blob) {
      const stale = blobUrlCache.get(trackId);
      if (stale) {
        URL.revokeObjectURL(stale);
        blobUrlCache.delete(trackId);
      }
      return null;
    }

    const existing = blobUrlCache.get(trackId);
    if (existing) {
      return existing;
    }

    const url = URL.createObjectURL(blob);
    blobUrlCache.set(trackId, url);
    return url;
  } catch {
    return null;
  }
}

export function revokePlaybackAudioUrl(trackId: string) {
  const existing = blobUrlCache.get(trackId);
  if (!existing) return;
  URL.revokeObjectURL(existing);
  blobUrlCache.delete(trackId);
}

export function clearBlobUrlCache() {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
}

export async function fetchRemotePlaybackAudioUrl(trackId: string): Promise<string | null> {
  const response = await fetch(`/resources/audio/${trackId}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { url: string };
  return data.url;
}

/** Fire-and-forget prefetch of a track's presigned URL (deduped per track). */
export function prefetchPlaybackAudioUrl(trackId: string): void {
  if (typeof window === "undefined") return;
  if (remoteUrlCache.has(trackId) || pendingRemoteFetches.has(trackId)) return;

  pendingRemoteFetches.add(trackId);
  void fetchRemotePlaybackAudioUrl(trackId)
    .then((url) => {
      if (url) remoteUrlCache.set(trackId, url);
    })
    .catch(() => {
      // Ignore — resolveTrackPlaybackSource will retry on demand.
    })
    .finally(() => {
      pendingRemoteFetches.delete(trackId);
    });
}

export async function resolveTrackPlaybackSource(trackId: string): Promise<string | null> {
  const offlineUrl = await resolvePlaybackAudioUrl(trackId);
  if (offlineUrl) return offlineUrl;

  const cached = remoteUrlCache.get(trackId);
  if (cached) return cached;

  try {
    const remoteUrl = await fetchRemotePlaybackAudioUrl(trackId);
    if (remoteUrl) {
      remoteUrlCache.set(trackId, remoteUrl);
      return remoteUrl;
    }
  } catch {
    // no-op: offline blob already checked above
  }

  return null;
}
