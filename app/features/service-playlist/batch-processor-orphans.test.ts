import { describe, expect, test } from "vitest";
import {
  buildPendingMatches,
  filterOrphanedTracks,
  getDuplicateMatchedTrackIds,
} from "./batch-processor.server";

describe("filterOrphanedTracks", () => {
  test("returns tracks missing from the current sync that are not deleted", () => {
    const processedExternalIds = new Set(["video-1"]);
    const processedTrackIds = new Set<string>();

    const orphaned = filterOrphanedTracks(
      [
        {
          position: 1,
          isDeleted: false,
          track: {
            id: "track-1",
            title: "Synced",
            artist: { id: "artist-1", name: "Artist" },
            externalId: "video-1",
          },
        },
        {
          position: 2,
          isDeleted: false,
          track: {
            id: "track-2",
            title: "Orphan",
            artist: { id: "artist-2", name: "Other Artist" },
            externalId: "video-2",
          },
        },
        {
          position: 3,
          isDeleted: false,
          track: {
            id: "track-still-synced",
            title: "Later in YouTube response",
            artist: { id: "artist-3", name: "Artist" },
            externalId: "video-later",
          },
        },
        {
          position: 4,
          isDeleted: true,
          track: {
            id: "track-4",
            title: "Already deleted",
            artist: null,
            externalId: "video-4",
          },
        },
      ],
      new Set(["video-1", "video-later"]),
      processedTrackIds,
    );

    expect(orphaned).toEqual([
      {
        id: "track-2",
        title: "Orphan",
        artist: "Other Artist",
        externalId: "video-2",
        position: 2,
        isDeleted: false,
      },
    ]);
  });

  test("does not exclude tracks merely because they appeared as candidates elsewhere", () => {
    const orphaned = filterOrphanedTracks(
      [
        {
          position: 1,
          isDeleted: false,
          track: {
            id: "orphan-a",
            title: "Orphan A",
            artist: { id: "a1", name: "Artist" },
            externalId: "video-a",
          },
        },
        {
          position: 2,
          isDeleted: false,
          track: {
            id: "orphan-b",
            title: "Orphan B",
            artist: { id: "a2", name: "Artist" },
            externalId: "video-b",
          },
        },
      ],
      new Set(),
      new Set(),
    );

    expect(orphaned.map((t) => t.id)).toEqual(["orphan-a", "orphan-b"]);
  });
});

describe("buildPendingMatches", () => {
  const candidates = [
    {
      id: "orphan-1",
      title: "Lost Track",
      artist: "Artist",
      externalId: "old-video",
      position: 5,
      isDeleted: false,
    },
  ];

  test("assigns the same candidate pool to every deleted video", () => {
    const matches = buildPendingMatches(
      [
        {
          position: 1,
          itemId: "item-1",
          title: "Deleted video",
          snippet: { title: "Deleted video" },
          externalId: "item-1",
        },
        {
          position: 2,
          itemId: "item-2",
          title: "Deleted video",
          snippet: { title: "Deleted video" },
          externalId: "item-2",
        },
      ],
      candidates,
    );

    expect(matches).toHaveLength(2);
    expect(matches[0]?.candidateTracks).toEqual(candidates);
    expect(matches[1]?.candidateTracks).toEqual(candidates);
  });

  test("returns no pending matches when there are no orphan candidates", () => {
    expect(
      buildPendingMatches(
        [
          {
            position: 1,
            itemId: "item-1",
            title: "Deleted video",
            snippet: { title: "Deleted video" },
            externalId: "item-1",
          },
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe("getDuplicateMatchedTrackIds", () => {
  test("returns empty when each matched track is unique", () => {
    expect(
      getDuplicateMatchedTrackIds([
        { action: "match", selectedTrackId: "t1" },
        { action: "match", selectedTrackId: "t2" },
        { action: "new", selectedTrackId: null },
        { action: "skip", selectedTrackId: null },
      ]),
    ).toEqual([]);
  });

  test("returns track ids selected more than once", () => {
    expect(
      getDuplicateMatchedTrackIds([
        { action: "match", selectedTrackId: "t1" },
        { action: "match", selectedTrackId: "t2" },
        { action: "match", selectedTrackId: "t1" },
      ]),
    ).toEqual(["t1"]);
  });
});
