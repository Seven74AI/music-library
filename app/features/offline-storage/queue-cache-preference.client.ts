/**
 * Device-local Queue Cache Preference: whether the player may auto-write
 * queue tracks to OPFS/IndexedDB. Scoped per userId; default enabled.
 */
export const QUEUE_CACHE_ENABLED_KEY_PREFIX = "music-library:queue-cache-enabled:";

function queueCacheEnabledKey(userId: string) {
  return `${QUEUE_CACHE_ENABLED_KEY_PREFIX}${userId}`;
}

/** Missing or invalid → enabled (today's default Queue Cache behavior). */
export function isQueueCacheEnabled(userId: string): boolean {
  if (typeof window === "undefined" || !userId) return true;

  try {
    const raw = window.localStorage.getItem(queueCacheEnabledKey(userId));
    if (raw === null) return true;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function setQueueCacheEnabled(userId: string, enabled: boolean): void {
  if (typeof window === "undefined" || !userId) return;

  try {
    window.localStorage.setItem(queueCacheEnabledKey(userId), enabled ? "true" : "false");
  } catch {
    // Best-effort — private mode / quota must never break the UI
  }
}
