import { remember } from "@epic-web/remember";
import { LRUCache } from "lru-cache";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;

type Window = { count: number; resetAt: number };

/**
 * In-memory per-key sliding-window rate limiter.
 *
 * Keyed by an arbitrary string (user id, room code, ...). Single-primary LiteFS
 * deployments make per-instance state sufficient for abuse prevention; this is
 * a complement to the global express-rate-limit in server/index.ts, which keys
 * on IP and cannot distinguish one authenticated user from another.
 */
export function makeRateLimiter(name: string, maxPerWindow: number) {
  const windows = remember(
    `rate-limit-${name}`,
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
