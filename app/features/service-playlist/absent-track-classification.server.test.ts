import { describe, expect, test } from "vitest";
import {
  classifyAbsentPlaylistTracks,
  isYouTubeVideoId,
  type AbsentPlaylistTrackRow,
} from "./absent-track-classification.server";

function row(
  overrides: Partial<AbsentPlaylistTrackRow> & Pick<AbsentPlaylistTrackRow, "sptId" | "trackId">,
): AbsentPlaylistTrackRow {
  return {
    title: "Some Track",
    artist: "Artist",
    externalId: "dQw4w9WgXcQ",
    position: 1,
    isDeleted: false,
    ...overrides,
  };
}

describe("isYouTubeVideoId", () => {
  test("accepts typical 11-character video ids", () => {
    expect(isYouTubeVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeVideoId("ZoYDkmD3tXU")).toBe(true);
  });

  test("rejects synthetic and empty ids", () => {
    expect(isYouTubeVideoId(null)).toBe(false);
    expect(isYouTubeVideoId("")).toBe(false);
    expect(isYouTubeVideoId("pending-pl-1")).toBe(false);
    expect(isYouTubeVideoId("deleted-pl-1-4")).toBe(false);
    expect(isYouTubeVideoId("short")).toBe(false);
  });
});

describe("classifyAbsentPlaylistTracks", () => {
  test("still-exists on YouTube → remove SPT, never candidate", () => {
    const result = classifyAbsentPlaylistTracks({
      absentTracks: [
        row({ sptId: "spt-rafyou", trackId: "track-rafyou", externalId: "ZoYDkmD3tXU" }),
      ],
      lookup: { status: "ok", existingIds: new Set(["ZoYDkmD3tXU"]) },
      hasDeferredDeletedItems: true,
    });

    expect([...result.removeSptIds]).toEqual(["spt-rafyou"]);
    expect(result.candidateTracks).toEqual([]);
    expect([...result.leaveAloneSptIds]).toEqual([]);
  });

  test("gone + deferred deleted items → match candidate, not removed", () => {
    const result = classifyAbsentPlaylistTracks({
      absentTracks: [
        row({
          sptId: "spt-gone",
          trackId: "track-gone",
          externalId: "abcdefghijk",
          title: "Lost Song",
          position: 5,
        }),
      ],
      lookup: { status: "ok", existingIds: new Set() },
      hasDeferredDeletedItems: true,
    });

    expect([...result.removeSptIds]).toEqual([]);
    expect(result.candidateTracks).toEqual([
      {
        id: "track-gone",
        title: "Lost Song",
        artist: "Artist",
        externalId: "abcdefghijk",
        position: 5,
        isDeleted: false,
      },
    ]);
    expect([...result.leaveAloneSptIds]).toEqual([]);
  });

  test("gone + no deferred deleted items → remove SPT", () => {
    const result = classifyAbsentPlaylistTracks({
      absentTracks: [row({ sptId: "spt-gone", trackId: "track-gone", externalId: "abcdefghijk" })],
      lookup: { status: "ok", existingIds: new Set() },
      hasDeferredDeletedItems: false,
    });

    expect([...result.removeSptIds]).toEqual(["spt-gone"]);
    expect(result.candidateTracks).toEqual([]);
  });

  test("lookup failure → leave alone (neither remove nor candidate)", () => {
    const result = classifyAbsentPlaylistTracks({
      absentTracks: [row({ sptId: "spt-1", trackId: "track-1", externalId: "ZoYDkmD3tXU" })],
      lookup: { status: "error" },
      hasDeferredDeletedItems: true,
    });

    expect([...result.removeSptIds]).toEqual([]);
    expect(result.candidateTracks).toEqual([]);
    expect([...result.leaveAloneSptIds]).toEqual(["spt-1"]);
  });

  test("synthetic externalId → leave alone without treating as still-exists", () => {
    const result = classifyAbsentPlaylistTracks({
      absentTracks: [row({ sptId: "spt-syn", trackId: "track-syn", externalId: "pending-pl-1" })],
      lookup: { status: "ok", existingIds: new Set(["pending-pl-1"]) },
      hasDeferredDeletedItems: true,
    });

    expect([...result.removeSptIds]).toEqual([]);
    expect(result.candidateTracks).toEqual([]);
    expect([...result.leaveAloneSptIds]).toEqual(["spt-syn"]);
  });

  test("deferred deletes with only still-exists absences → remove absences, no candidates", () => {
    const result = classifyAbsentPlaylistTracks({
      absentTracks: [
        row({ sptId: "spt-a", trackId: "t-a", externalId: "ZoYDkmD3tXU" }),
        row({ sptId: "spt-b", trackId: "t-b", externalId: "J-qHhKuEulA" }),
      ],
      lookup: { status: "ok", existingIds: new Set(["ZoYDkmD3tXU", "J-qHhKuEulA"]) },
      hasDeferredDeletedItems: true,
    });

    expect(new Set(result.removeSptIds)).toEqual(new Set(["spt-a", "spt-b"]));
    expect(result.candidateTracks).toEqual([]);
  });
});
