import { describe, expect, test, beforeEach, vi } from "vitest";
import { createMemoryOfflineAudioStore } from "./memory-audio-store.ts";
import { createOfflineMetadataStore } from "./metadata-store.client.ts";
import { createOfflineStorage } from "./offline-storage.client.ts";

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

describe("createOfflineStorage", () => {
  beforeEach(async () => {
    const metadataStore = createOfflineMetadataStore();
    await metadataStore.clear();
  });

  test("failed metadata put leaves no orphan blob", async () => {
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
    expect(await metadataStore.get(track.id)).toEqual(before);
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

  test("evicts queue-only tracks before pinned ones when quota is tight", async () => {
    const audioStore = createMemoryOfflineAudioStore();
    const metadataStore = createOfflineMetadataStore();
    const storage = createOfflineStorage({
      audioStore,
      metadataStore,
      fetchAudioBytes: async (trackId) =>
        new Uint8Array(trackId === "track-1" ? 500_000 : 400_000).buffer,
      requestPersistentStorage: async () => {},
      readStorageEstimate: async () => ({ usage: 900_000, quota: 1_000_000 }),
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
