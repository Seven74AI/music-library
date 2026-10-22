import { describe, expect, test } from "vitest";
import {
  buildLibraryUserTracksWhere,
  parseHasAudioOnlyParam,
  parseLibraryGenreParam,
} from "./library-user-tracks.server";

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

  test("genre filter matches tracks tagged with that genre id", () => {
    expect(
      buildLibraryUserTracksWhere({ userId, hasAudioOnly: false, genreId: "genre-1" }),
    ).toEqual({
      userId,
      isActive: true,
      deletedAt: null,
      track: { genres: { some: { id: "genre-1" } } },
    });
  });

  test("genre and audio filters both apply", () => {
    expect(buildLibraryUserTracksWhere({ userId, hasAudioOnly: true, genreId: "genre-1" })).toEqual(
      {
        userId,
        isActive: true,
        deletedAt: null,
        track: {
          audioFiles: { some: {} },
          genres: { some: { id: "genre-1" } },
        },
      },
    );
  });

  test("blank genre id does not filter", () => {
    expect(buildLibraryUserTracksWhere({ userId, hasAudioOnly: false, genreId: "  " })).toEqual({
      userId,
      isActive: true,
      deletedAt: null,
    });
  });
});

describe("parseLibraryGenreParam", () => {
  test("returns a trimmed genre id", () => {
    expect(parseLibraryGenreParam(new URLSearchParams("genre=genre-1"))).toBe("genre-1");
    expect(parseLibraryGenreParam(new URLSearchParams("genre=%20jazz-id%20"))).toBe("jazz-id");
  });

  test("returns null when the param is missing or blank", () => {
    expect(parseLibraryGenreParam(new URLSearchParams())).toBeNull();
    expect(parseLibraryGenreParam(new URLSearchParams("genre="))).toBeNull();
    expect(parseLibraryGenreParam(new URLSearchParams("genre=%20%20"))).toBeNull();
  });
});
