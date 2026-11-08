import { describe, expect, test } from "vitest";
import { mutationRateLimitTier } from "./mutation-rate-limit.ts";

describe("mutationRateLimitTier", () => {
  test("admin mutations are capped at 60 per minute", () => {
    expect(mutationRateLimitTier("POST", "/admin/audio-queue")).toBe("admin");
    expect(mutationRateLimitTier("POST", "/api/admin/tracks/track-1")).toBe("admin");
    expect(mutationRateLimitTier("DELETE", "/music/admin/duplicates")).toBe("admin");
  });

  test("login and other sensitive mutations stay on the strict tier", () => {
    expect(mutationRateLimitTier("POST", "/login")).toBe("sensitive");
    expect(mutationRateLimitTier("POST", "/signup")).toBe("sensitive");
    expect(mutationRateLimitTier("POST", "/reset-password")).toBe("sensitive");
    expect(mutationRateLimitTier("GET", "/verify")).toBe("sensitive");
  });

  test("reading an admin page uses the normal read tier", () => {
    expect(mutationRateLimitTier("GET", "/admin/audio-queue")).toBe("read");
    expect(mutationRateLimitTier("HEAD", "/admin/users")).toBe("read");
  });

  test("ordinary mutations use the general tier", () => {
    expect(mutationRateLimitTier("POST", "/playlists/playlist-1")).toBe("general");
  });
});
