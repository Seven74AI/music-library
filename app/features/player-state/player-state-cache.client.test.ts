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
  writeCachedPlayerState(savedState);

  expect(readCachedPlayerState()).toEqual(savedState);
});

test("returns null when no state has been mirrored", () => {
  expect(readCachedPlayerState()).toBeNull();
});

test("returns null for corrupt JSON", () => {
  window.localStorage.setItem("music-library:player-state", "{not-json");
  expect(readCachedPlayerState()).toBeNull();
});

test("returns null for a structurally invalid state", () => {
  window.localStorage.setItem(
    "music-library:player-state",
    JSON.stringify({ playContext: { type: "nonsense" }, upNextIds: "not-an-array" }),
  );
  expect(readCachedPlayerState()).toBeNull();
});

test("writes do not throw when localStorage is unavailable", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });

  expect(() => writeCachedPlayerState(savedState)).not.toThrow();
});
