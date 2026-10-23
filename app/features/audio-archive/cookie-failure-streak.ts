import { ErrorCategory, type ErrorCategory as ErrorCategoryType } from "./yt-dlp.server.ts";

export const COOKIE_FAILURE_PAUSE_THRESHOLD = 3;

export function isCookieExpiredFailure(category: ErrorCategoryType | string): boolean {
  return category === ErrorCategory.COOKIE_EXPIRED;
}

export function createCookieFailureStreak(threshold = COOKIE_FAILURE_PAUSE_THRESHOLD) {
  let count = 0;

  return {
    recordFailure(): boolean {
      count++;
      if (count >= threshold) {
        count = 0;
        return true;
      }
      return false;
    },
    recordSuccess(): void {
      count = 0;
    },
    reset(): void {
      count = 0;
    },
    getCount(): number {
      return count;
    },
  };
}

const cookieFailureStreak = createCookieFailureStreak();

// NOTE: this streak is a module-level in-memory singleton — it resets on process
// restart and is counted per-instance, so the 3-failure auto-pause can be
// weakened across a restart boundary (contrast WorkerState, which IS persisted).
// Accepted as low-impact: a cookie-expired failure already invalidates the
// cookies and notifies an admin on the FIRST failure; the streak only gates the
// worker pause, not the invalidation/notification.

/** Record a cookie-expired failure; returns true when the queue should pause. */
export function recordCookieExpiredFailure(): boolean {
  return cookieFailureStreak.recordFailure();
}

export function recordArchiveSuccess(): void {
  cookieFailureStreak.recordSuccess();
}

export function resetCookieFailureStreak(): void {
  cookieFailureStreak.reset();
}
