import { remember } from "@epic-web/remember";
import { LRUCache } from "lru-cache";
import {
  ADD_TRACK_RATE_PER_MIN,
  AUDITION_GRANT_RATE_PER_MIN,
  RATE_LIMIT_WINDOW_MS,
  ROOM_SEARCH_RATE_PER_MIN,
} from "./constants.ts";

type Window = { count: number; resetAt: number };

function makeLimiter(name: string, maxPerWindow: number) {
  const windows = remember(
    `party-room-rate-${name}`,
    () => new LRUCache<string, Window>({ max: 10_000, ttl: RATE_LIMIT_WINDOW_MS }),
  );

  return {
    consume(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
      const existing = windows.get(key);
      if (!existing || existing.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      existing.count += 1;
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return { allowed: existing.count <= maxPerWindow, retryAfterSeconds };
    },
    reset() {
      windows.clear();
    },
  };
}

export const addTrackRateLimit = makeLimiter("add-track", ADD_TRACK_RATE_PER_MIN);
export const roomSearchRateLimit = makeLimiter("search", ROOM_SEARCH_RATE_PER_MIN);
export const auditionGrantRateLimit = makeLimiter("audition", AUDITION_GRANT_RATE_PER_MIN);

/** Test helper — clears all Party Room rate-limit windows. */
export function resetPartyRoomRateLimits(): void {
  addTrackRateLimit.reset();
  roomSearchRateLimit.reset();
  auditionGrantRateLimit.reset();
}
