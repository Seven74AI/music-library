import { describe, expect, test } from "vitest";
import { buildLibraryUserTracksWhere, parseHasAudioOnlyParam } from "./library-user-tracks.server";

describe("parseHasAudioOnlyParam", () => {
  test("returns true when hasAudio=1", () => {
    const params = new URLSearchParams("hasAudio=1");
    expect(parseHasAudioOnlyParam(params)).toBe(true);
  });

  test("returns false when param is absent", () => {
    expect(parseHasAudioOnlyParam(new URLSearchParams())).toBe(false);
  });

  test("returns false for other values", () => {
    expect(parseHasAudioOnlyParam(new URLSearchParams("hasAudio=0"))).toBe(false);
    expect(parseHasAudioOnlyParam(new URLSearchParams("hasAudio=true"))).toBe(false);
  });
});

describe("buildLibraryUserTracksWhere", () => {
  const userId = "user-1";

  test("without audio filter excludes inactive and deleted user tracks", () => {
    expect(buildLibraryUserTracksWhere({ userId, hasAudioOnly: false })).toEqual({
      userId,
      isActive: true,
      deletedAt: null,
    });
  });

  test("with audio filter requires at least one audio file", () => {
    expect(buildLibraryUserTracksWhere({ userId, hasAudioOnly: true })).toEqual({
      userId,
      isActive: true,
      deletedAt: null,
      track: { audioFiles: { some: {} } },
    });
  });
});
