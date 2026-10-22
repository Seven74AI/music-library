import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  addSuccessfulTrack,
  cleanupOldProgress,
  getUploadProgress,
  initUploadProgress,
  MAX_UPLOAD_PROGRESS_ENTRIES,
  resetUploadProgressStoreForTests,
  serializeSuccessfulTrack,
  startUploadProgressSweeper,
  stopUploadProgressSweeper,
} from "./upload-progress.$uploadId.tsx";

function uniqueUploadId(prefix = "upload") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

beforeEach(() => {
  resetUploadProgressStoreForTests();
});

afterEach(() => {
  stopUploadProgressSweeper();
  vi.useRealTimers();
});

test("successful track payload keeps the real storage saved byte count", () => {
  const uploadId = uniqueUploadId();
  initUploadProgress(uploadId, ["song.mp3"]);
  addSuccessfulTrack(uploadId, {
    trackId: "track-1",
    fileName: "song.mp3",
    title: "Song",
    artist: "Artist",
    storageSavedBytes: 2 * 1024 * 1024,
    exactDuplicate: {
      trackId: "track-0",
      title: "Song",
      artist: "Artist",
      confidence: 100,
    },
  });

  const stored = getUploadProgress(uploadId)?.successfulTracks?.[0];
  expect(stored?.storageSavedBytes).toBe(2 * 1024 * 1024);

  const payload = serializeSuccessfulTrack(stored!);
  expect(payload.storageSavedBytes).toBe(2 * 1024 * 1024);
  const serialized = JSON.parse(JSON.stringify(payload)) as { storageSavedBytes?: number };
  expect(serialized.storageSavedBytes).toBe(2 * 1024 * 1024);
});

test("omits storage saved bytes from the payload when the size is unknown", () => {
  const track = serializeSuccessfulTrack({
    trackId: "track-1",
    fileName: "song.mp3",
    title: "Song",
    artist: "Artist",
  });

  expect(track.storageSavedBytes).toBeUndefined();
  expect(JSON.parse(JSON.stringify(track))).not.toHaveProperty("storageSavedBytes");
});

test("cleanupOldProgress reclaims sessions with no recent activity", () => {
  const abandoned = uniqueUploadId("abandoned");
  const fresh = uniqueUploadId("fresh");
  initUploadProgress(abandoned, ["a.mp3"]);
  initUploadProgress(fresh, ["b.mp3"]);

  // Age the abandoned session far beyond the TTL window.
  getUploadProgress(abandoned)!.lastUpdated = 0;

  const remaining = cleanupOldProgress({ now: 1_000_000, ttlMs: 60_000 });

  expect(getUploadProgress(abandoned)).toBeUndefined();
  expect(getUploadProgress(fresh)).toBeDefined();
  expect(remaining).toBe(1);
});

test("cleanupOldProgress keeps sessions with recent activity", () => {
  const uploadId = uniqueUploadId();
  initUploadProgress(uploadId, ["a.mp3"]);

  cleanupOldProgress({ ttlMs: 60_000 });

  // lastUpdated is stamped at init (now), so it must survive a sweep at "now".
  expect(getUploadProgress(uploadId)).toBeDefined();
});

test("cleanupOldProgress enforces the max-entry cap, evicting least-recent first", () => {
  const over = 5;
  const ids: string[] = [];
  for (let i = 0; i < MAX_UPLOAD_PROGRESS_ENTRIES + over; i++) {
    const id = uniqueUploadId(`cap-${i}`);
    ids.push(id);
    initUploadProgress(id, ["x.mp3"]);
    // Distinct, increasing recency so the smallest lastUpdated values are evicted first.
    getUploadProgress(id)!.lastUpdated = i;
  }

  // Huge TTL so only the cap evicts.
  const remaining = cleanupOldProgress({ now: 1_000_000_000, ttlMs: 1_000_000_000_000 });

  expect(remaining).toBe(MAX_UPLOAD_PROGRESS_ENTRIES);
  // The `over` least-recently-updated sessions are evicted.
  for (let i = 0; i < over; i++) {
    expect(getUploadProgress(ids[i]!)).toBeUndefined();
  }
  // The rest survive.
  expect(getUploadProgress(ids[over]!)).toBeDefined();
  expect(getUploadProgress(ids[ids.length - 1]!)).toBeDefined();
});

test("startUploadProgressSweeper registers a single interval and is idempotent", () => {
  vi.useFakeTimers();
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

  startUploadProgressSweeper();
  startUploadProgressSweeper();

  expect(setIntervalSpy).toHaveBeenCalledTimes(1);
});
