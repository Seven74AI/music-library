import { describe, expect, test } from "vitest";
import {
  defaultPlaylistTrackSortDirection,
  parsePlaylistTrackSort,
  sortPlaylistTracks,
} from "./playlist-track-sort.ts";

const tracks = [
  {
    id: "pt-1",
    position: 1,
    createdAt: "2024-01-02T00:00:00.000Z",
    track: { title: "Zebra", artist: { name: "Beta" }, duration: 200 },
  },
  {
    id: "pt-2",
    position: 0,
    createdAt: "2024-01-03T00:00:00.000Z",
    track: { title: "Apple", artist: { name: "Alpha" }, duration: 100 },
  },
  {
    id: "pt-3",
    position: 2,
    createdAt: "2024-01-01T00:00:00.000Z",
    track: { title: "Mango", artist: { name: "Gamma" }, duration: null },
  },
];

describe("parsePlaylistTrackSort", () => {
  test("defaults to custom for unknown values", () => {
    expect(parsePlaylistTrackSort(null)).toBe("custom");
    expect(parsePlaylistTrackSort("nope")).toBe("custom");
  });

  test("accepts known sort options", () => {
    expect(parsePlaylistTrackSort("title")).toBe("title");
    expect(parsePlaylistTrackSort("dateAdded")).toBe("dateAdded");
  });
});

describe("defaultPlaylistTrackSortDirection", () => {
  test("uses asc for title/artist/duration and desc for dateAdded", () => {
    expect(defaultPlaylistTrackSortDirection("title")).toBe("asc");
    expect(defaultPlaylistTrackSortDirection("artist")).toBe("asc");
    expect(defaultPlaylistTrackSortDirection("duration")).toBe("asc");
    expect(defaultPlaylistTrackSortDirection("dateAdded")).toBe("desc");
    expect(defaultPlaylistTrackSortDirection("custom")).toBe("asc");
  });
});

describe("sortPlaylistTracks", () => {
  test("sorts by playlist position for custom and ignores direction", () => {
    expect(sortPlaylistTracks(tracks, "custom").map((t) => t.id)).toEqual(["pt-2", "pt-1", "pt-3"]);
    expect(sortPlaylistTracks(tracks, "custom", "desc").map((t) => t.id)).toEqual([
      "pt-2",
      "pt-1",
      "pt-3",
    ]);
  });

  test("sorts by title ascending by default and descending when requested", () => {
    expect(sortPlaylistTracks(tracks, "title").map((t) => t.id)).toEqual(["pt-2", "pt-3", "pt-1"]);
    expect(sortPlaylistTracks(tracks, "title", "desc").map((t) => t.id)).toEqual([
      "pt-1",
      "pt-3",
      "pt-2",
    ]);
  });

  test("sorts by artist ascending by default and descending when requested", () => {
    expect(sortPlaylistTracks(tracks, "artist").map((t) => t.id)).toEqual(["pt-2", "pt-1", "pt-3"]);
    expect(sortPlaylistTracks(tracks, "artist", "desc").map((t) => t.id)).toEqual([
      "pt-3",
      "pt-1",
      "pt-2",
    ]);
  });

  test("sorts by duration with nulls last in both directions", () => {
    expect(sortPlaylistTracks(tracks, "duration").map((t) => t.id)).toEqual([
      "pt-2",
      "pt-1",
      "pt-3",
    ]);
    expect(sortPlaylistTracks(tracks, "duration", "desc").map((t) => t.id)).toEqual([
      "pt-1",
      "pt-2",
      "pt-3",
    ]);
  });

  test("sorts by date added newest first by default and oldest first when ascending", () => {
    expect(sortPlaylistTracks(tracks, "dateAdded").map((t) => t.id)).toEqual([
      "pt-2",
      "pt-1",
      "pt-3",
    ]);
    expect(sortPlaylistTracks(tracks, "dateAdded", "asc").map((t) => t.id)).toEqual([
      "pt-3",
      "pt-1",
      "pt-2",
    ]);
  });
});
