import { describe, expect, test } from "vitest";
import { ADD_TRACK_RATE_PER_MIN } from "./constants.ts";
import { addTrackRateLimit } from "./rate-limit.server.ts";

describe("party-room rate limits", () => {
  test("add-track budget allows up to cap then blocks", () => {
    // Unique key avoids cross-file interference with the process-local limiter.
    const key = `participant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < ADD_TRACK_RATE_PER_MIN; i++) {
      expect(addTrackRateLimit.consume(key).allowed).toBe(true);
    }
    const blocked = addTrackRateLimit.consume(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
