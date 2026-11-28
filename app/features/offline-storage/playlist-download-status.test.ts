import { describe, expect, test } from "vitest";
import { computePlaylistDownloadStatus } from "./playlist-download-status.ts";
import { type OfflineTrackSummary } from "./types.ts";

function summary(trackId: string, isPinned = true): OfflineTrackSummary {
  return {
    trackId,
    title: trackId,
    artistId: "a",
    artistName: "A",
    duration: 1,
    coverObjectKey: null,
    audioFormat: "mp3",
    isPinned,
    isQueueCached: !isPinned,
    fileSizeBytes: 1,
    lastAccessedAt: 0,
  };
}

describe("computePlaylistDownloadStatus", () => {
  test("complete when all ids are present and pinned", () => {
    const s = computePlaylistDownloadStatus(["a", "b"], [summary("a"), summary("b")]);
    expect(s.isComplete).toBe(true);
    expect(s.isPartial).toBe(false);
    expect(s.total).toBe(2);
    expect([...s.missingIds]).toEqual([]);
  });

  test("none downloaded is neither complete nor partial", () => {
    const s = computePlaylistDownloadStatus(["a", "b"], []);
    expect(s.isComplete).toBe(false);
    expect(s.isPartial).toBe(false);
    expect([...s.missingIds]).toEqual(["a", "b"]);
  });

  test("partial when some are downloaded", () => {
    const s = computePlaylistDownloadStatus(["a", "b", "c"], [summary("a")]);
    expect(s.isPartial).toBe(true);
    expect([...s.downloadedIds]).toEqual(["a"]);
    expect([...s.missingIds]).toEqual(["b", "c"]);
  });

  test("queue-cached (unpinned) summaries count as missing", () => {
    const s = computePlaylistDownloadStatus(["a"], [summary("a", false)]);
    expect(s.isComplete).toBe(false);
    expect([...s.missingIds]).toEqual(["a"]);
  });

  test("summaries for removed tracks are ignored", () => {
    const s = computePlaylistDownloadStatus(["a"], [summary("a"), summary("gone")]);
    expect(s.total).toBe(1);
    expect(s.isComplete).toBe(true);
    expect(s.downloadedIds.has("gone")).toBe(false);
  });

  test("empty id list is not complete", () => {
    const s = computePlaylistDownloadStatus([], [summary("a")]);
    expect(s.isComplete).toBe(false);
    expect(s.isPartial).toBe(false);
    expect(s.total).toBe(0);
  });

  test("duplicate ids are de-duplicated", () => {
    const s = computePlaylistDownloadStatus(["a", "a", "b"], [summary("a")]);
    expect(s.total).toBe(2);
    expect([...s.missingIds]).toEqual(["b"]);
  });
});
