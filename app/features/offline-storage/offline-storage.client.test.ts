import { describe, expect, test, beforeEach, vi } from "vitest";
import { createMemoryOfflineAudioStore } from "./memory-audio-store.ts";
import { createOfflineMetadataStore } from "./metadata-store.client.ts";
import { createOfflineStorage, OfflineStorageQuotaError } from "./offline-storage.client.ts";

const deleteCachedCover = vi.fn().mockResolvedValue(undefined);
vi.mock("./cover-cache.client.ts", () => ({
  cacheCoverImage: vi.fn().mockResolvedValue(undefined),
  deleteCachedCover: (...args: unknown[]) => deleteCachedCover(...args),
}));

/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";

const track = {
  id: "track-1",
  title: "Offline Song",
  artist: { id: "artist-1", name: "Artist" },
  duration: 210,
  coverImage: null,
  audioFiles: [{ id: "af-1", format: "mp3", objectKey: "k" }],
};

/**
 * Storage estimate with room for the 50 MiB headroom plus 600 KB of tracks;
 * usage grows as tracks are stored and shrinks when they are evicted.
 */
function tightEstimate(metadataStore: ReturnType<typeof createOfflineMetadataStore>) {
  const headroom = 50 * 1024 * 1024;
  return async () => {
    const used = (await metadataStore.list()).reduce((sum, t) => sum + t.fileSizeBytes, 0);
    return { usage: headroom - 600_000 + used, quota: 2 * headroom };
  };
}

describe("createOfflineStorage", () => {
  beforeEach(async () => {
    const metadataStore = createOfflineMetadataStore();
    await metadataStore.clear();
  });

  test("failed metadata put leaves prior metadata and rolls back the new blob", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    vi.spyOn(metadataStore, "put").mockRejectedValue(new Error("metadata put failed"));

    await expect(storage.downloadTrack(track, { pin: true })).rejects.toThrow(
      "metadata put failed",
    );

    expect(await audioStore.has(track.id, "mp3")).toBe(false);
    expect(await metadataStore.get(track.id)).toBeFalsy();
  });

  test("failed metadata update on an existing track keeps the prior blob and metadata", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true });
    const before = await metadataStore.get(track.id);
    expect(before).toBeTruthy();
    const originalBytes = await audioStore.read(track.id, "mp3");
    expect(originalBytes).not.toBeNull();

    vi.spyOn(metadataStore, "put").mockRejectedValue(new Error("metadata update failed"));

    await expect(
      storage.downloadTrack(
        {
          ...track,
          audioFiles: [{ id: "af-1", format: "mp3", objectKey: "k2" }],
        },
        { pin: true },
      ),
    ).rejects.toThrow();

    expect(await audioStore.has(track.id, "mp3")).toBe(true);
    const afterBytes = await audioStore.read(track.id, "mp3");
    expect(new Uint8Array(afterBytes!)).toEqual(new Uint8Array(originalBytes!));
    expect(await metadataStore.get(track.id)).toEqual(before);
  });

  test("failed old-format delete leaves record pointing at the original file", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([9, 9, 9]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true });
    const before = await metadataStore.get(track.id);
    expect(before).toBeTruthy();
    const originalBytes = await audioStore.read(track.id, "mp3");
    expect(originalBytes).not.toBeNull();

    const originalDelete = audioStore.delete.bind(audioStore);
    vi.spyOn(audioStore, "delete").mockImplementation(async (trackId, format) => {
      if (trackId === track.id && format === "mp3") {
        throw new Error("old format delete failed");
      }
      return originalDelete(trackId, format);
    });

    await expect(
      storage.downloadTrack(
        {
          ...track,
          audioFiles: [{ id: "af-flac", format: "flac", objectKey: "k-flac" }],
        },
        { pin: true },
      ),
    ).rejects.toThrow(/old format delete failed/);

    expect(await metadataStore.get(track.id)).toEqual(before);
    expect(await audioStore.has(track.id, "mp3")).toBe(true);
    expect(await audioStore.has(track.id, "flac")).toBe(false);
    expect(new Uint8Array((await audioStore.read(track.id, "mp3"))!)).toEqual(
      new Uint8Array(originalBytes!),
    );
  });

  test("re-download with a new audio format removes the previous format blob", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true });
    expect(await audioStore.has(track.id, "mp3")).toBe(true);

    await storage.downloadTrack(
      {
        ...track,
        audioFiles: [{ id: "af-flac", format: "flac", objectKey: "k-flac" }],
      },
      { pin: true },
    );

    expect(await audioStore.has(track.id, "mp3")).toBe(false);
    expect(await audioStore.has(track.id, "flac")).toBe(true);
    const record = await metadataStore.get(track.id);
    expect(record?.audioFormat).toBe("flac");
  });

  test("downloads and resolves pinned playback blobs", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true });
    expect(await storage.hasTrack(track.id)).toBe(true);

    const blob = await storage.resolvePlaybackBlob(track.id);
    expect(blob).not.toBeNull();
    expect((await blob!.arrayBuffer()).byteLength).toBe(3);
  });

  test("default fetch uses same-origin stream route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);

    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true });

    expect(fetchMock).toHaveBeenCalledWith("/resources/audio/track-1?stream=1", {
      credentials: "same-origin",
    });

    vi.unstubAllGlobals();
  });

  test("records file size before OPFS write detaches the buffer", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array(3_538_581).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    const originalWrite = audioStore.write.bind(audioStore);
    audioStore.write = async (trackId, data) => {
      const copy = data.slice(0);
      const { port1, port2 } = new MessageChannel();
      port1.postMessage(data, [data]);
      port2.onmessage = () => {};
      await originalWrite(trackId, copy);
    };

    await storage.downloadTrack(track, { pin: true });

    const record = await storage.getRecord(track.id);
    expect(record?.fileSizeBytes).toBe(3_538_581);

    const stats = await storage.getStorageStats();
    expect(stats.totalBytes).toBe(3_538_581);
  });

  test("LRU eviction removes cover blob when no other offline track references it", async () => {
    const coverKey = "covers/evict-only.jpg";
    const queueTrack = {
      ...track,
      id: "queue-cover",
      title: "Queue with cover",
      coverImage: { objectKey: coverKey },
    };

    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array(400_000).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: tightEstimate(metadataStore),
    });

    deleteCachedCover.mockClear();
    await storage.downloadTrack(queueTrack, { pin: false });
    await storage.downloadTrack(track, { pin: true });

    expect(await storage.hasTrack("queue-cover")).toBe(false);
    expect(deleteCachedCover).toHaveBeenCalledWith(coverKey);
  });

  test("evicts queue-only tracks before pinned ones when quota is tight", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async (trackId) =>
        new Uint8Array(trackId === "track-1" ? 500_000 : 400_000).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: tightEstimate(metadataStore),
    });

    await storage.downloadTrack({ ...track, id: "queue-track", title: "Queue" }, { pin: false });
    await storage.downloadTrack(track, { pin: true });

    expect(await storage.hasTrack("queue-track")).toBe(false);
    expect(await storage.hasTrack("track-1")).toBe(true);
  });

  test("listDownloaded drops metadata when OPFS audio is missing", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true });
    await audioStore.delete(track.id, "mp3");

    expect(await storage.listDownloaded()).toEqual([]);
    expect(await metadataStore.get(track.id)).toBeFalsy();
  });

  test("listForPlaylist reflects a pinned playlist download and drops a track whose OPFS bytes are gone", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });
    const second = { ...track, id: "track-2", title: "Second" };

    await storage.downloadTrack(track, { pin: true, playlistId: "pl-1" });
    await storage.downloadTrack(second, { pin: true, playlistId: "pl-1" });
    expect((await storage.listForPlaylist("pl-1")).map((s) => s.trackId).sort()).toEqual([
      "track-1",
      "track-2",
    ]);

    await audioStore.delete(second.id, "mp3");

    const remaining = await storage.listForPlaylist("pl-1");
    expect(remaining.map((s) => s.trackId)).toEqual(["track-1"]);
    expect(remaining[0]?.isPinned).toBe(true);
  });

  test("a track pinned for another playlist is not listed for pl-1 until downloaded with pl-1", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true, playlistId: "pl-other" });
    expect(await storage.listForPlaylist("pl-1")).toEqual([]);

    await storage.downloadTrack(track, { pin: true, playlistId: "pl-1" });
    expect((await storage.listForPlaylist("pl-1")).map((s) => s.trackId)).toEqual(["track-1"]);
    expect((await storage.getRecord(track.id))?.playlistIds).toEqual(
      expect.arrayContaining(["pl-other", "pl-1"]),
    );
  });

  test("cacheQueueTrack preserves pin when OPFS bytes are missing", async () => {
    const fetchAudioBytes = vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9]).buffer);
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true, playlistId: "pl-1" });
    await audioStore.delete(track.id, "mp3");

    await storage.cacheQueueTrack(track);

    const record = await storage.getRecord(track.id);
    expect(record?.isPinned).toBe(true);
    expect(record?.isQueueCached).toBe(true);
    expect(record?.playlistIds).toContain("pl-1");
  });

  test("removeTrack keeps shared cover cache when another offline row references it", async () => {
    const coverKey = "covers/shared.jpg";
    const trackWithCover = (id: string) => ({
      ...track,
      id,
      coverImage: { objectKey: coverKey },
    });

    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(trackWithCover("track-a"), { pin: true });
    await storage.downloadTrack(trackWithCover("track-b"), { pin: true });
    deleteCachedCover.mockClear();

    await storage.removeTrack("track-b");
    expect(deleteCachedCover).not.toHaveBeenCalled();

    await storage.removeTrack("track-a");
    expect(deleteCachedCover).toHaveBeenCalledWith(coverKey);
  });

  test("cacheQueueTrack keeps pinned metadata when re-download fails", async () => {
    const fetchAudioBytes = vi
      .fn()
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer)
      .mockRejectedValue(new Error("network down"));
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true, playlistId: "pl-keep" });
    await audioStore.delete(track.id, "mp3");

    await expect(storage.cacheQueueTrack(track)).rejects.toThrow(/network down/);

    const record = await storage.getRecord(track.id);
    expect(record?.isPinned).toBe(true);
    expect(record?.playlistIds).toContain("pl-keep");
  });

  test("cacheQueueTrack re-downloads when metadata exists without OPFS bytes", async () => {
    const fetchAudioBytes = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]).buffer);
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: false });
    await audioStore.delete(track.id, "mp3");
    fetchAudioBytes.mockClear();

    await storage.cacheQueueTrack(track);

    expect(fetchAudioBytes).toHaveBeenCalledWith(track.id);
    expect(await storage.hasTrack(track.id)).toBe(true);
  });

  test("downloadTrack throws OfflineStorageQuotaError when eviction cannot free enough space", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const fetchAudioBytes = vi.fn(async () => new Uint8Array(6_000_000).buffer);
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 995_000_000, quota: 1_000_000_000 }),
    });

    await expect(storage.downloadTrack(track, { pin: true })).rejects.toBeInstanceOf(
      OfflineStorageQuotaError,
    );
    expect(await audioStore.has(track.id, "mp3")).toBe(false);
  });

  test("a track that fits is stored even when free space is below the headroom", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array(5_000_000).buffer,
      requestPersistentStorage: async () => {},
      // 40 MiB free: under the 50 MiB headroom, but the 5 MB track fits.
      readStorageEstimate: async () => ({ usage: 1_000_000_000 - 40 * 1024 * 1024, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack(track, { pin: true });
    expect(await storage.hasTrack(track.id)).toBe(true);
  });

  test("does not evict cache when evictable bytes cannot make the track fit", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    let size = 10;
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array(size).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1000 }),
    });

    await storage.downloadTrack({ ...track, id: "cached" }, { pin: false });
    size = 5000;
    await expect(storage.downloadTrack(track, { pin: true })).rejects.toBeInstanceOf(
      OfflineStorageQuotaError,
    );
    expect(await storage.hasTrack("cached")).toBe(true);
  });

  test("a failed staging write is cleaned up", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });
    const deleteSpy = vi.spyOn(audioStore, "delete");
    vi.spyOn(audioStore, "write").mockRejectedValue(new Error("write failed"));

    await expect(storage.downloadTrack(track, { pin: true })).rejects.toThrow("write failed");
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.stringContaining("__staging__"),
      "mp3",
    );
  });

  test("re-pinning a queue-cached track that eviction removes still succeeds", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    let size = 400;
    let usage = 0;
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array(size).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage, quota: 1000 }),
    });

    await storage.downloadTrack(track, { pin: false });
    usage = 400;
    size = 500;
    await storage.downloadTrack(track, { pin: true });
    expect((await storage.getRecord(track.id))?.isPinned).toBe(true);
    expect(await storage.hasTrack(track.id)).toBe(true);
  });

  test("concurrent downloads of the same track serialize", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await Promise.all([
      storage.downloadTrack(track, { pin: true }),
      storage.downloadTrack(track, { pin: true }),
      storage.cacheQueueTrack(track),
    ]);
    expect(await storage.hasTrack(track.id)).toBe(true);
    expect((await storage.getRecord(track.id))?.isPinned).toBe(true);
  });

  test("re-download accounts for the staging file and the live file coexisting", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const bytes = new Uint8Array(1000).buffer;
    let estimate = { usage: 0, quota: 1_000_000_000 };
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => bytes,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => estimate,
    });

    await storage.downloadTrack(track, { pin: true });

    // Room for exactly one copy, but not two.
    estimate = { usage: 0, quota: 1500 };
    await expect(storage.downloadTrack(track, { pin: true })).rejects.toBeInstanceOf(
      OfflineStorageQuotaError,
    );
    expect(await audioStore.has(track.id, "mp3")).toBe(true);
  });

  test("purgeQueueCache removes queue-only tracks and keeps pinned", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async () => new Uint8Array([1, 2, 3]).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 0, quota: 1_000_000_000 }),
    });

    await storage.downloadTrack({ ...track, id: "queue-only", title: "Queue" }, { pin: false });
    await storage.downloadTrack(track, { pin: true });
    await storage.downloadTrack(
      { ...track, id: "pinned-and-queued", title: "Both" },
      { pin: true },
    );
    // Mark pinned track as also queue-cached (both flags)
    const both = await storage.getRecord("pinned-and-queued");
    expect(both).not.toBeNull();
    await metadataStore.put({ ...both!, isQueueCached: true });

    const result = await storage.purgeQueueCache();

    expect(result.removedCount).toBe(1);
    expect(await storage.hasTrack("queue-only")).toBe(false);
    expect(await storage.hasTrack("track-1")).toBe(true);
    expect(await storage.hasTrack("pinned-and-queued")).toBe(true);
  });
});
