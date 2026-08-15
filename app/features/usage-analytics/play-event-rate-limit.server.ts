import { remember } from "@epic-web/remember";
import { LRUCache } from "lru-cache";

/**
 * Per-user throttle for play events. The express limiter in `server/index.ts`
 * buckets by IP, which cannot stop a single authenticated account from inflating
 * usage metrics — this adds the per-user dimension.
 *
 * Real playback emits roughly two events per track, so this ceiling is far above
 * legitimate use and only bites on scripted abuse.
 */
export const PLAY_EVENT_WINDOW_MS = 60_000;
export const PLAY_EVENT_MAX_PER_WINDOW = 60;

type Window = { count: number; resetAt: number };

const windows = remember(
  "play-event-rate-limit",
  () => new LRUCache<string, Window>({ max: 10_000, ttl: PLAY_EVENT_WINDOW_MS }),
);

/**
 * Records an attempt and reports whether it is allowed. Returns the seconds
 * until the window resets so the caller can send a `Retry-After` header.
 */
export function consumePlayEventBudget(
  userId: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const existing = windows.get(userId);

  if (!existing || existing.resetAt <= now) {
    windows.set(userId, { count: 1, resetAt: now + PLAY_EVENT_WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  return { allowed: existing.count <= PLAY_EVENT_MAX_PER_WINDOW, retryAfterSeconds };
}

/** Test helper — drops all recorded windows. */
export function resetPlayEventBudgets(): void {
  windows.clear();
}
