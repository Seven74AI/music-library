import { describe, expect, it, vi, beforeEach } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { noopArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { processTracksInBatches } from "./batch-processor.server";
import { createYouTubeTrackSyncProcessor } from "./youtube-track-sync.server";

function createTxMock() {
  const artistCreate = vi
    .fn()
    .mockImplementation(({ data }: any) =>
      Promise.resolve({ id: `artist-${data.name}`, name: data.name }),
    );
  return {
    tx: {
      track: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi
          .fn()
          .mockImplementation(({ create }: any) => Promise.resolve({ id: "track-1", ...create })),
      },
      artist: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: artistCreate,
      },
      servicePlaylistTrack: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: "spt-1" }),
      },
      archiveJob: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    },
    artistCreate,
  };
}

describe("processTracksInBatches - artist naming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses videoOwnerChannelTitle (the video uploader) as the artist", async () => {
    const { tx, artistCreate } = createTxMock();

    await processTracksInBatches(
      [
        {
          snippet: {
            title: "Some Song",
            resourceId: { videoId: "video1" },
            videoOwnerChannelTitle: "Uploader Channel",
            channelTitle: "Playlist Owner Channel",
            thumbnails: { default: { url: "https://example.com/t.jpg" } },
          },
        },
      ],
      "service-1",
      "playlist-1",
      tx,
      createYouTubeTrackSyncProcessor(),
      noopArchiveEnqueueAdapter,
    );

    expect(artistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Uploader Channel" }),
      }),
    );
  });

  it("falls back to Unknown Artist — never channelTitle, which is the playlist owner, not the uploader", async () => {
    const { tx, artistCreate } = createTxMock();

    await processTracksInBatches(
      [
        {
          snippet: {
            title: "Some Song",
            resourceId: { videoId: "video2" },
            // no videoOwnerChannelTitle
            channelTitle: "Playlist Owner Channel",
            thumbnails: { default: { url: "https://example.com/t.jpg" } },
          },
        },
      ],
      "service-1",
      "playlist-1",
      tx,
      createYouTubeTrackSyncProcessor(),
      noopArchiveEnqueueAdapter,
    );

    expect(artistCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Unknown Artist" }),
      }),
    );
  });
});

describe("processTracksInBatches - ingest failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still marks a playlist item as seen when preparation throws so re-sync will not drop it", async () => {
    consoleError.mockImplementation(() => {});
    const { tx, artistCreate } = createTxMock();
    artistCreate
      .mockRejectedValueOnce(new Error("unique constraint"))
      .mockImplementation(({ data }: { data: { name: string } }) =>
        Promise.resolve({ id: `artist-${data.name}`, name: data.name }),
      );

    const result = await processTracksInBatches(
      [
        {
          snippet: {
            title: "Fails to prepare",
            resourceId: { videoId: "video-fail" },
            videoOwnerChannelTitle: "Broken Artist",
          },
        },
        {
          snippet: {
            title: "Succeeds",
            resourceId: { videoId: "video-ok" },
            videoOwnerChannelTitle: "Healthy Artist",
          },
        },
      ],
      "service-1",
      "playlist-1",
      tx,
      createYouTubeTrackSyncProcessor(),
      noopArchiveEnqueueAdapter,
    );

    expect(result.processedIds.externalIds.has("video-fail")).toBe(true);
    expect(result.processedIds.externalIds.has("video-ok")).toBe(true);
    expect(result.processedCount).toBe(1);
  });
});
