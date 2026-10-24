import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  addFailedFile,
  addSuccessfulTrack,
  cleanupOldProgress,
  deleteUploadProgress,
  getUploadProgress,
  initUploadProgress,
  MAX_UPLOAD_PROGRESS_ENTRIES,
  resetUploadProgressStoreForTests,
  serializeSuccessfulTrack,
  startUploadProgressSweeper,
  stopUploadProgressSweeper,
  subscribeToProgressUpdates,
  updateFileProgress,
} from "./progress-store.server.ts";

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

test("successful track payload keeps the real storage saved byte count", async () => {
  const uploadId = uniqueUploadId();
  await initUploadProgress(uploadId, ["song.mp3"]);
  await addSuccessfulTrack(uploadId, {
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

  const stored = (await getUploadProgress(uploadId))?.successfulTracks?.[0];
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

test("initUploadProgress creates a pending file entry per file name", async () => {
  const uploadId = uniqueUploadId();
  await initUploadProgress(uploadId, ["a.mp3", "b.flac"]);

  const entry = await getUploadProgress(uploadId);
  expect(entry).toBeDefined();
  expect(entry?.status).toBe("active");
  expect(entry?.overallProgress).toBe(0);
  expect(entry?.files).toEqual([
    { fileId: "file-0", fileName: "a.mp3", progress: 0, status: "pending" },
    { fileId: "file-1", fileName: "b.flac", progress: 0, status: "pending" },
  ]);
});

test("updateFileProgress recomputes overall progress and completes when all files finish", async () => {
  const uploadId = uniqueUploadId();
  await initUploadProgress(uploadId, ["a.mp3", "b.mp3"]);

  await updateFileProgress(uploadId, "file-0", 100, "completed");
  await updateFileProgress(uploadId, "file-1", 100, "completed");

  const entry = await getUploadProgress(uploadId);
  expect(entry?.overallProgress).toBe(100);
  expect(entry?.status).toBe("completed");
});

test("updateFileProgress marks the session failed when any file fails", async () => {
  const uploadId = uniqueUploadId();
  await initUploadProgress(uploadId, ["a.mp3", "b.mp3"]);

  await updateFileProgress(uploadId, "file-0", 100, "completed");
  await updateFileProgress(uploadId, "file-1", 0, "failed", "boom");

  const entry = await getUploadProgress(uploadId);
  expect(entry?.status).toBe("failed");
  expect(entry?.files.find((f) => f.fileId === "file-1")?.error).toBe("boom");
});

test("addFailedFile records the failure without a retry buffer", async () => {
  const uploadId = uniqueUploadId();
  await initUploadProgress(uploadId, ["a.mp3"]);

  await addFailedFile(uploadId, "file-0", "invalid");

  const entry = await getUploadProgress(uploadId);
  expect(entry?.failedFiles).toEqual([{ fileId: "file-0", fileName: "a.mp3", error: "invalid" }]);
  // No audio buffer may live in the shared store (Redis-safe).
  expect(JSON.stringify(entry)).not.toContain("buffer");
});

test("cleanupOldProgress reclaims sessions with no recent activity", async () => {
  const abandoned = uniqueUploadId("abandoned");
  const fresh = uniqueUploadId("fresh");
  await initUploadProgress(abandoned, ["a.mp3"]);
  await initUploadProgress(fresh, ["b.mp3"]);

  // Age the abandoned session far beyond the TTL window.
  (await getUploadProgress(abandoned))!.lastUpdated = 0;

  const remaining = await cleanupOldProgress({ now: 1_000_000, ttlMs: 60_000 });

  expect(await getUploadProgress(abandoned)).toBeUndefined();
  expect(await getUploadProgress(fresh)).toBeDefined();
  expect(remaining).toBe(1);
});

test("cleanupOldProgress keeps sessions with recent activity", async () => {
  const uploadId = uniqueUploadId();
  await initUploadProgress(uploadId, ["a.mp3"]);

  await cleanupOldProgress({ ttlMs: 60_000 });

  expect(await getUploadProgress(uploadId)).toBeDefined();
});

test("cleanupOldProgress enforces the max-entry cap, evicting least-recent first", async () => {
  const over = 5;
  const ids: string[] = [];
  for (let i = 0; i < MAX_UPLOAD_PROGRESS_ENTRIES + over; i++) {
    const id = uniqueUploadId(`cap-${i}`);
    ids.push(id);
    await initUploadProgress(id, ["x.mp3"]);
    (await getUploadProgress(id))!.lastUpdated = i;
  }

  // Huge TTL so only the cap evicts.
  const remaining = await cleanupOldProgress({
    now: 1_000_000_000,
    ttlMs: 1_000_000_000_000,
  });

  expect(remaining).toBe(MAX_UPLOAD_PROGRESS_ENTRIES);
  for (let i = 0; i < over; i++) {
    expect(await getUploadProgress(ids[i]!)).toBeUndefined();
  }
  expect(await getUploadProgress(ids[over]!)).toBeDefined();
  expect(await getUploadProgress(ids[ids.length - 1]!)).toBeDefined();
});

test("deleteUploadProgress removes the session", async () => {
  const uploadId = uniqueUploadId();
  await initUploadProgress(uploadId, ["a.mp3"]);

  await deleteUploadProgress(uploadId);

  expect(await getUploadProgress(uploadId)).toBeUndefined();
});

test("startUploadProgressSweeper registers a single interval and is idempotent", () => {
  vi.useFakeTimers();
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

  startUploadProgressSweeper();
  startUploadProgressSweeper();

  expect(setIntervalSpy).toHaveBeenCalledTimes(1);
});

test("subscribeToProgressUpdates notifies listeners on mutation", async () => {
  const uploadId = uniqueUploadId();
  const listener = vi.fn();
  const unsubscribe = subscribeToProgressUpdates(listener);

  await initUploadProgress(uploadId, ["a.mp3"]);
  expect(listener).toHaveBeenCalledWith(uploadId);

  unsubscribe();
  await updateFileProgress(uploadId, "file-0", 50, "uploading");
  expect(listener).toHaveBeenCalledTimes(1);
});
