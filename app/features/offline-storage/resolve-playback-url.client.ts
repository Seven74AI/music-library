import { getOfflineStorage } from "#app/features/offline-storage/offline-storage.client.ts";

const blobUrlCache = new Map<string, string>();

// Presigned remote URLs are cached so the next track can be prefetched while
// the current one plays. This keeps the auto-advance transition off the
// network (critical on lock screens, where background fetches are throttled).
//
// Server signs for 3600s; keep a safety margin so we re-fetch before the CDN
// starts returning 403 on expired URLs.
const PRESIGNED_URL_TTL_MS = 55 * 60 * 1000;

type CachedRemoteUrl = {
  url: string;
  expiresAt: number;
};

const remoteUrlCache = new Map<string, CachedRemoteUrl>();
const pendingRemoteFetches = new Set<string>();

export class OfflineDataCorruptedError extends Error {
  constructor(message = "Offline data is corrupted or unavailable") {
    super(message);
    this.name = "OfflineDataCorruptedError";
  }
}

function getCachedRemoteUrl(trackId: string): string | null {
  const entry = remoteUrlCache.get(trackId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    remoteUrlCache.delete(trackId);
    return null;
  }
  return entry.url;
}

function setCachedRemoteUrl(trackId: string, url: string) {
  remoteUrlCache.set(trackId, {
    url,
    expiresAt: Date.now() + PRESIGNED_URL_TTL_MS,
  });
}

export function invalidateRemotePlaybackUrl(trackId: string) {
  remoteUrlCache.delete(trackId);
  pendingRemoteFetches.delete(trackId);
}

/** Synchronous cache peek for gapless auto-advance handoffs. */
export function peekCachedPlaybackUrl(trackId: string): string | null {
  return blobUrlCache.get(trackId) ?? getCachedRemoteUrl(trackId);
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
  remoteUrlCache.clear();
  pendingRemoteFetches.clear();
}

export async function fetchRemotePlaybackAudioUrl(trackId: string): Promise<string | null> {
  const response = await fetch(`/resources/audio/${trackId}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { url: string };
  return data.url;
}

/** Fire-and-forget prefetch of a track's playable source (remote URL + offline blob). */
export function prefetchPlaybackAudioUrl(trackId: string): void {
  if (typeof window === "undefined") return;

  // Warm the offline blob cache when the track is already downloaded so the
  // handoff can prefer a local URL without waiting on OPFS at transition time.
  void resolvePlaybackAudioUrl(trackId);

  if (getCachedRemoteUrl(trackId) || pendingRemoteFetches.has(trackId)) return;

  pendingRemoteFetches.add(trackId);
  void fetchRemotePlaybackAudioUrl(trackId)
    .then((url) => {
      if (url) setCachedRemoteUrl(trackId, url);
    })
    .catch(() => {
      // Ignore — resolveTrackPlaybackSource will retry on demand.
    })
    .finally(() => {
      pendingRemoteFetches.delete(trackId);
    });
}

export async function resolveTrackPlaybackSource(trackId: string): Promise<string | null> {
  // Sync caches first so auto-advance does not await OPFS/IndexedDB when the
  // next track was prefetched during the previous song.
  const synced = peekCachedPlaybackUrl(trackId);
  if (synced) return synced;

  const offlineUrl = await resolvePlaybackAudioUrl(trackId);
  if (offlineUrl) return offlineUrl;

  try {
    const remoteUrl = await fetchRemotePlaybackAudioUrl(trackId);
    if (remoteUrl) {
      setCachedRemoteUrl(trackId, remoteUrl);
      return remoteUrl;
    }
  } catch {
    // no-op: offline blob already checked above
  }

  return null;
}
