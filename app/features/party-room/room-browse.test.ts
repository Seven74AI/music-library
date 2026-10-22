import { expect, test } from "vitest";
import {
  parseRoomBrowseType,
  readRoomSearchReturn,
  roomAlbumHref,
  roomArtistHref,
  roomArtistTrackNote,
  roomSearchHref,
} from "./room-browse.ts";

test("builds room search, album, and artist paths", () => {
  expect(roomSearchHref("AB3K9Q")).toBe("/rooms/AB3K9Q/search");
  expect(roomSearchHref("AB3K9Q", { q: "  ", type: "all" })).toBe("/rooms/AB3K9Q/search");
  expect(roomSearchHref("AB3K9Q", { q: "love song", type: "albums" })).toBe(
    "/rooms/AB3K9Q/search?q=love+song&type=albums",
  );
  expect(roomAlbumHref("AB3K9Q", "album-1")).toBe("/rooms/AB3K9Q/search/albums/album-1");
  expect(roomArtistHref("AB3K9Q", "artist-1")).toBe("/rooms/AB3K9Q/search/artists/artist-1");
});

test("reads the search return state carried onto album and artist pages", () => {
  expect(readRoomSearchReturn({ q: "love", type: "artists" })).toEqual({
    q: "love",
    type: "artists",
  });
  expect(readRoomSearchReturn(null)).toEqual({ q: "", type: "all" });
  expect(readRoomSearchReturn({ q: 12, type: "nope" })).toEqual({ q: "", type: "all" });
  expect(parseRoomBrowseType("tracks")).toBe("tracks");
  expect(parseRoomBrowseType("playlists")).toBe("all");
});

test("notes when an artist has more playable tracks than the page lists", () => {
  expect(roomArtistTrackNote(2, 2)).toBeNull();
  expect(roomArtistTrackNote(100, 140)).toBe("Showing 100 of 140 playable tracks");
});
