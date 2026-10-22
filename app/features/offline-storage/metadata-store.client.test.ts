/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { describe, expect, test, beforeEach } from "vitest";
import { type OfflineMetadataStore, createOfflineMetadataStore } from "./metadata-store.client.ts";
import { toOfflineTrackRecord } from "./types.ts";

const sampleTrack = {
  id: "track-1",
  title: "Song",
  artist: { id: "artist-1", name: "Artist" },
  duration: 200,
  coverImage: null,
  audioFiles: [{ id: "af-1", format: "mp3", objectKey: "audio/x.mp3" }],
};

describe("OfflineMetadataStore", () => {
  let store: OfflineMetadataStore;

  beforeEach(async () => {
    store = createOfflineMetadataStore();
    await store.clear();
  });

  test("puts and lists offline tracks", async () => {
    await store.put(
      toOfflineTrackRecord(sampleTrack, {
        opfsPath: "audio/track-1.mp3",
        fileSizeBytes: 1234,
        isPinned: true,
        isQueueCached: false,
      }),
    );

    const tracks = await store.list();
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.trackId).toBe("track-1");
    expect(tracks[0]?.isPinned).toBe(true);
  });

  test("filters pinned tracks for offline library view", async () => {
    await store.put(
      toOfflineTrackRecord(sampleTrack, {
        opfsPath: "audio/track-1.mp3",
        fileSizeBytes: 100,
        isPinned: true,
        isQueueCached: false,
      }),
    );
    await store.put(
      toOfflineTrackRecord(
        { ...sampleTrack, id: "track-2", title: "Queue song" },
        {
          opfsPath: "audio/track-2.mp3",
          fileSizeBytes: 100,
          isPinned: false,
          isQueueCached: true,
        },
      ),
    );

    expect(await store.listPinned()).toHaveLength(1);
    expect(await store.listDownloaded()).toHaveLength(2);
  });

  test("efficiently lists many downloaded tracks", async () => {
    const trackCount = 1000;
    const startTime = performance.now();

    for (let i = 0; i < trackCount; i++) {
      await store.put(
        toOfflineTrackRecord(
          { ...sampleTrack, id: `track-${i}`, title: `Song ${i}` },
          {
            opfsPath: `audio/track-${i}.mp3`,
            fileSizeBytes: 1000,
            isPinned: i % 2 === 0,
            isQueueCached: i % 2 !== 0,
          },
        ),
      );
    }

    const insertTime = performance.now() - startTime;

    const listStart = performance.now();
    const allTracks = await store.list();
    const listTime = performance.now() - listStart;

    const pinnedStart = performance.now();
    const pinnedTracks = await store.listPinned();
    const pinnedTime = performance.now() - pinnedStart;

    expect(allTracks).toHaveLength(trackCount);
    expect(pinnedTracks).toHaveLength(trackCount / 2);

    console.log(`Insert ${trackCount} tracks: ${insertTime.toFixed(2)}ms`);
    console.log(`List all ${trackCount} tracks: ${listTime.toFixed(2)}ms`);
    console.log(`List ${pinnedTracks.length} pinned tracks: ${pinnedTime.toFixed(2)}ms`);

    expect(listTime).toBeLessThan(500);
    expect(pinnedTime).toBeLessThan(500);
  });
});
