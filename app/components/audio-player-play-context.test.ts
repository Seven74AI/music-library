import { describe, expect, test } from "vitest";
import {
  hasPersistableQueue,
  isSamePlayContext,
  playContextToJson,
  shouldPersistPlayerState,
  type PlaylistContext,
} from "./audio-player-play-context.ts";
import { type PlayerStateData } from "#app/features/player-state/player-state.ts";

function libraryContext(overrides: Partial<PlaylistContext> = {}): PlaylistContext {
  return { type: "library", ...overrides };
}

function playlistContext(
  playlistId: string,
  overrides: Partial<PlaylistContext> = {},
): PlaylistContext {
  return { type: "playlist", playlistId, ...overrides };
}

function state(overrides: Partial<PlayerStateData> = {}): PlayerStateData {
  return {
    playContext: null,
    currentTrackId: null,
    upNextIds: [],
    shuffleSeed: null,
    loopMode: "off",
    ...overrides,
  };
}

describe("isSamePlayContext", () => {
  test("null left context is never equal", () => {
    expect(isSamePlayContext(null, libraryContext())).toBe(false);
  });

  test("different types are not equal", () => {
    expect(isSamePlayContext(libraryContext(), playlistContext("p1"))).toBe(false);
  });

  test("different ids are not equal", () => {
    expect(isSamePlayContext(playlistContext("p1"), playlistContext("p2"))).toBe(false);
    expect(
      isSamePlayContext({ type: "artist", artistId: "a1" }, { type: "artist", artistId: "a2" }),
    ).toBe(false);
    expect(
      isSamePlayContext({ type: "track", trackId: "t1" }, { type: "track", trackId: "t2" }),
    ).toBe(false);
  });

  test("matching simple contexts are equal", () => {
    expect(
      isSamePlayContext({ type: "artist", artistId: "a1" }, { type: "artist", artistId: "a1" }),
    ).toBe(true);
    expect(
      isSamePlayContext({ type: "album", albumId: "al1" }, { type: "album", albumId: "al1" }),
    ).toBe(true);
  });

  test("playlist contexts compare sort (defaulting custom)", () => {
    // both undefined sort → both "custom" → equal
    expect(isSamePlayContext(playlistContext("p1"), playlistContext("p1"))).toBe(true);
    // undefined vs explicit "custom" → equal
    expect(
      isSamePlayContext(playlistContext("p1"), playlistContext("p1", { sort: "custom" })),
    ).toBe(true);
    // custom vs title → not equal
    expect(isSamePlayContext(playlistContext("p1"), playlistContext("p1", { sort: "title" }))).toBe(
      false,
    );
  });

  test("library contexts compare sort (defaulting dateAdded)", () => {
    expect(isSamePlayContext(libraryContext(), libraryContext())).toBe(true);
    expect(
      isSamePlayContext(libraryContext(), libraryContext({ librarySort: "mostPlayedMonth" })),
    ).toBe(false);
  });

  test("discover contexts compare sort (defaulting recentlyAdded)", () => {
    expect(isSamePlayContext({ type: "discover" }, { type: "discover" })).toBe(true);
    expect(
      isSamePlayContext({ type: "discover" }, { type: "discover", discoverSort: "titleAZ" }),
    ).toBe(false);
  });
});

describe("playContextToJson", () => {
  test("null → null", () => {
    expect(playContextToJson(null)).toBeNull();
  });

  test("context without required spine id → null", () => {
    expect(playContextToJson({ type: "track" })).toBeNull();
  });

  test("library default sort/direction omitted", () => {
    expect(playContextToJson(libraryContext())).toEqual({ type: "library" });
  });

  test("library non-default sort retained", () => {
    expect(playContextToJson(libraryContext({ librarySort: "mostPlayedMonth" }))).toEqual({
      type: "library",
      sort: "mostPlayedMonth",
    });
  });

  test("playlist default custom sort omitted", () => {
    expect(playContextToJson(playlistContext("p1"))).toEqual({
      type: "playlist",
      playlistId: "p1",
    });
  });

  test("playlist non-custom sort retained", () => {
    expect(playContextToJson(playlistContext("p1", { sort: "title" }))).toEqual({
      type: "playlist",
      playlistId: "p1",
      sort: "title",
    });
  });

  test("id-based contexts pass through", () => {
    expect(playContextToJson({ type: "artist", artistId: "a1" })).toEqual({
      type: "artist",
      artistId: "a1",
    });
    expect(playContextToJson({ type: "album", albumId: "al1" })).toEqual({
      type: "album",
      albumId: "al1",
    });
    expect(playContextToJson({ type: "track", trackId: "t1" })).toEqual({
      type: "track",
      trackId: "t1",
    });
    expect(playContextToJson({ type: "onRepeatSnapshot", snapshotId: "s1" })).toEqual({
      type: "onRepeatSnapshot",
      snapshotId: "s1",
    });
  });

  test("discover default sort omitted", () => {
    expect(playContextToJson({ type: "discover" })).toEqual({ type: "discover" });
  });

  test("discover non-default sort retained", () => {
    expect(playContextToJson({ type: "discover", discoverSort: "titleAZ" })).toEqual({
      type: "discover",
      sort: "titleAZ",
    });
  });
});

describe("hasPersistableQueue", () => {
  test("empty state is not persistable", () => {
    expect(hasPersistableQueue(state())).toBe(false);
  });

  test("current track makes it persistable", () => {
    expect(hasPersistableQueue(state({ currentTrackId: "t1" }))).toBe(true);
  });

  test("up-next ids make it persistable", () => {
    expect(hasPersistableQueue(state({ upNextIds: ["t1"] }))).toBe(true);
  });

  test("play context makes it persistable", () => {
    expect(
      hasPersistableQueue(state({ playContext: { type: "playlist", playlistId: "p1" } })),
    ).toBe(true);
  });
});

describe("shouldPersistPlayerState", () => {
  test("persists when already restored for the same user", () => {
    expect(shouldPersistPlayerState("u1", "u1", false, state())).toBe(true);
  });

  test("persists when user mutated a persistable queue", () => {
    expect(shouldPersistPlayerState("u1", null, true, state({ currentTrackId: "t1" }))).toBe(true);
  });

  test("does not persist without user mutation", () => {
    expect(shouldPersistPlayerState("u1", null, false, state({ currentTrackId: "t1" }))).toBe(
      false,
    );
  });

  test("does not persist mutated but empty queue", () => {
    expect(shouldPersistPlayerState("u1", null, true, state())).toBe(false);
  });
});
