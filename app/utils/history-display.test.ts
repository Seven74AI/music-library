import { expect, test } from "vitest";
import {
  collectRelationIds,
  coverLabel,
  displayedChange,
  displayLabels,
} from "./history-display.ts";

test("collects artist, album, and cover ids from both sides of a change", () => {
  expect(
    collectRelationIds([
      {
        artistId: { from: "artist-1", to: "artist-2" },
        albumId: { from: null, to: "album-1" },
        title: { from: "Old", to: "New" },
      },
      {
        coverImageId: { from: "cover-1", to: null },
        artistId: { from: "artist-2", to: "artist-2" },
      },
    ]),
  ).toEqual({
    artistIds: ["artist-1", "artist-2"],
    albumIds: ["album-1"],
    coverIds: ["cover-1"],
  });
});

test("labels relation changes with entity names and leaves other fields alone", () => {
  const labels = displayLabels(
    {
      artistId: { from: "artist-1", to: "artist-2" },
      albumId: { from: null, to: "missing-album" },
      title: { from: "Old", to: "New" },
      coverImageId: { from: "cover-1", to: "cover-2" },
    },
    {
      artist: new Map([
        ["artist-1", "Bill Evans"],
        ["artist-2", "Miles Davis"],
      ]),
      album: new Map(),
      cover: new Map([
        ["cover-1", "Cover image (300×300)"],
        ["cover-2", "Cover image"],
      ]),
    },
  );

  expect(labels).toEqual({
    artistId: { from: "Bill Evans", to: "Miles Davis" },
    albumId: { from: "(empty)", to: "Unknown album" },
    coverImageId: { from: "Cover image (300×300)", to: "Cover image" },
  });
});

test("cover label uses dimensions when they exist", () => {
  expect(coverLabel({ width: 640, height: 480 })).toBe("Cover image (640×480)");
  expect(coverLabel({ width: null, height: 480 })).toBe("Cover image");
  expect(coverLabel({ width: null, height: null })).toBe("Cover image");
});

test("displayed change prefers the entity name over the stored id", () => {
  expect(
    displayedChange(
      { from: "artist-1", to: "artist-2" },
      { from: "Bill Evans", to: "Miles Davis" },
      (value) => String(value),
    ),
  ).toEqual({ from: "Bill Evans", to: "Miles Davis" });

  expect(
    displayedChange({ from: "Rock", to: null }, undefined, (value) =>
      value == null ? "(empty)" : String(value),
    ),
  ).toEqual({ from: "Rock", to: "(empty)" });
});
