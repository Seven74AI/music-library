/**
 * @vitest-environment jsdom
 */
import { expect, test, vi, beforeEach } from "vitest";
import { type PlayerStateData } from "./player-state.ts";
import { readCachedPlayerState, writeCachedPlayerState } from "./player-state-cache.client.ts";

const savedState: PlayerStateData = {
  playContext: { type: "playlist", playlistId: "playlist-1" },
  currentTrackId: "track-1",
  upNextIds: ["track-2", "track-3"],
  shuffleSeed: 42,
  loopMode: "all",
};

beforeEach(() => {
  window.localStorage.clear();
});

test("round-trips a player state through the local mirror", () => {
  writeCachedPlayerState("user-1", savedState);

  expect(readCachedPlayerState("user-1")).toEqual(savedState);
});

test("returns null when no state has been mirrored", () => {
  expect(readCachedPlayerState("user-1")).toBeNull();
});

test("scopes the mirror per user so accounts on a shared browser do not leak", () => {
  writeCachedPlayerState("user-a", savedState);
  writeCachedPlayerState("user-b", { ...savedState, currentTrackId: "track-other" });

  expect(readCachedPlayerState("user-a")?.currentTrackId).toBe("track-1");
  expect(readCachedPlayerState("user-b")?.currentTrackId).toBe("track-other");
  expect(readCachedPlayerState("user-c")).toBeNull();
});

test("returns null for corrupt JSON", () => {
  window.localStorage.setItem("music-library:player-state:user-1", "{not-json");
  expect(readCachedPlayerState("user-1")).toBeNull();
});

test("returns null for a structurally invalid state", () => {
  window.localStorage.setItem(
    "music-library:player-state:user-1",
    JSON.stringify({ playContext: { type: "nonsense" }, upNextIds: "not-an-array" }),
  );
  expect(readCachedPlayerState("user-1")).toBeNull();
});

test("writes do not throw when localStorage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });

  expect(() => writeCachedPlayerState("user-1", savedState)).not.toThrow();
});

test("returns null when the play context direction is invalid", () => {
  window.localStorage.setItem(
    "music-library:player-state:user-1",
    JSON.stringify({
      playContext: { type: "library", direction: "up" },
      currentTrackId: "track-1",
      upNextIds: [],
      shuffleSeed: null,
      loopMode: "all",
    }),
  );

  expect(readCachedPlayerState("user-1")).toBeNull();
});

test("returns null when the sort option is not canonical for the context", () => {
  // "titleAZ" is a valid discover sort but NOT a library sort.
  window.localStorage.setItem(
    "music-library:player-state:user-1",
    JSON.stringify({
      playContext: { type: "library", sort: "titleAZ", direction: "asc" },
      currentTrackId: "track-1",
      upNextIds: [],
      shuffleSeed: null,
      loopMode: "all",
    }),
  );

  expect(readCachedPlayerState("user-1")).toBeNull();
});

test("round-trips a valid library context with sort and direction", () => {
  const state: PlayerStateData = {
    playContext: { type: "library", sort: "dateAdded", direction: "desc" },
    currentTrackId: "track-1",
    upNextIds: [],
    shuffleSeed: null,
    loopMode: "all",
  };

  writeCachedPlayerState("user-1", state);
  expect(readCachedPlayerState("user-1")).toEqual(state);
});
