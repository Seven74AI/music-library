/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import {
  formatPlayerTime,
  generatePlayId,
  getMediaErrorMessage,
  getPlaybackProgressPercent,
  isDurationKnown,
  swapPlaybackSource,
  withRecoveryNonce,
} from "./audio-player-format.ts";

describe("formatPlayerTime", () => {
  test("non-finite → 0:00", () => {
    expect(formatPlayerTime(NaN)).toBe("0:00");
    expect(formatPlayerTime(Infinity)).toBe("0:00");
  });

  test("zero → 0:00", () => {
    expect(formatPlayerTime(0)).toBe("0:00");
  });

  test("pads seconds under ten", () => {
    expect(formatPlayerTime(65)).toBe("1:05");
    expect(formatPlayerTime(59)).toBe("0:59");
  });

  test("whole minutes", () => {
    expect(formatPlayerTime(600)).toBe("10:00");
  });
});

describe("isDurationKnown", () => {
  test("zero, negative, and non-finite are unknown", () => {
    expect(isDurationKnown(0)).toBe(false);
    expect(isDurationKnown(-5)).toBe(false);
    expect(isDurationKnown(NaN)).toBe(false);
    expect(isDurationKnown(Infinity)).toBe(false);
  });

  test("positive finite is known", () => {
    expect(isDurationKnown(180)).toBe(true);
  });
});

describe("getPlaybackProgressPercent", () => {
  test("unknown duration → 0", () => {
    expect(getPlaybackProgressPercent(30, 0)).toBe(0);
    expect(getPlaybackProgressPercent(30, -1)).toBe(0);
    expect(getPlaybackProgressPercent(30, Infinity)).toBe(0);
  });

  test("midpoint", () => {
    expect(getPlaybackProgressPercent(50, 100)).toBe(50);
  });

  test("clamps to 0..100", () => {
    expect(getPlaybackProgressPercent(150, 100)).toBe(100);
    expect(getPlaybackProgressPercent(-10, 100)).toBe(0);
  });
});

describe("getMediaErrorMessage", () => {
  test("maps known MediaError codes", () => {
    expect(getMediaErrorMessage(1)).toContain("interrupted");
    expect(getMediaErrorMessage(2)).toContain("network");
    expect(getMediaErrorMessage(3)).toContain("not supported");
    expect(getMediaErrorMessage(4)).toContain("not supported");
  });

  test("unknown code falls back", () => {
    expect(getMediaErrorMessage(99)).toContain("unexpected");
  });
});

describe("generatePlayId", () => {
  test("returns a UUID v4-shaped string", () => {
    const id = generatePlayId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("swapPlaybackSource", () => {
  function fakeAudio(overrides: Record<string, unknown> = {}) {
    const listeners = new Map<string, () => void>();
    return {
      src: "",
      currentTime: 0,
      readyState: 0,
      play: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn((event: string, cb: () => void) => {
        listeners.set(event, cb);
      }),
      _listeners: listeners,
      ...overrides,
    };
  }

  test("sets src, restores position, resumes play", () => {
    const audio = fakeAudio({ currentTime: 30, readyState: 0 });
    swapPlaybackSource(audio as never, "https://x/a.mp3", 30, true);
    expect(audio.src).toBe("https://x/a.mp3");
    expect(audio.currentTime).toBe(30);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  test("does not resume when shouldResume is false", () => {
    const audio = fakeAudio({ currentTime: 30, readyState: 0 });
    swapPlaybackSource(audio as never, "https://x/a.mp3", 30, false);
    expect(audio.play).not.toHaveBeenCalled();
  });

  test("skips position restore for non-finite/zero savedTime", () => {
    const audio = fakeAudio({ currentTime: 7, readyState: 0 });
    swapPlaybackSource(audio as never, "https://x/a.mp3", 0, false);
    expect(audio.currentTime).toBe(7);
  });

  test("does not attach loadeddata listener when media already ready", () => {
    const audio = fakeAudio({ readyState: 2 });
    swapPlaybackSource(audio as never, "https://x/a.mp3", 0, false);
    expect(audio.addEventListener).not.toHaveBeenCalled();
  });

  test("attaches loadeddata listener when media not ready", () => {
    const audio = fakeAudio({ readyState: 0 });
    swapPlaybackSource(audio as never, "https://x/a.mp3", 0, false);
    expect(audio.addEventListener).toHaveBeenCalledWith("loadeddata", expect.any(Function), {
      once: true,
    });
  });
});

describe("withRecoveryNonce", () => {
  test("adds a recovery query to a path-only speaker grant URL", () => {
    expect(withRecoveryNonce("/resources/rooms/audio/track-1", 1700000000000)).toBe(
      "/resources/rooms/audio/track-1?recovery=1700000000000",
    );
  });

  test("appends to an existing query string", () => {
    expect(withRecoveryNonce("/resources/rooms/audio/track-1?stream=1", 9)).toBe(
      "/resources/rooms/audio/track-1?stream=1&recovery=9",
    );
  });

  test("keeps a hash suffix after the recovery query", () => {
    expect(withRecoveryNonce("/resources/rooms/audio/track-1#t=12", 9)).toBe(
      "/resources/rooms/audio/track-1?recovery=9#t=12",
    );
  });
});
