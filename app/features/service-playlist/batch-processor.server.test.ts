import { describe, expect, it, vi, beforeEach } from "vitest";
import { consoleError } from "#tests/setup/setup-test-env.ts";
import { type Prisma } from "#prisma/client.js";
import { noopArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { processTracksInBatches } from "./batch-processor.server";
import { createYouTubeTrackSyncProcessor } from "./youtube-track-sync.server";

function createTxMock() {
  const artistCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: { name: string } }) =>
      Promise.resolve({ id: `artist-${data.name}`, name: data.name }),
    );
  const tx = {
    track: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi
        .fn()
        .mockImplementation(({ create }: { create: Record<string, unknown> }) =>
          Promise.resolve({ id: "track-1", ...create }),
        ),
    },
    artist: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: artistCreate,
    },
    servicePlaylistTrack: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({ id: "spt-1" }),
    },
    archiveJob: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as Prisma.TransactionClient;
  return {
    tx,
    artistCreate,
  };
}

describe("processTracksInBatches - archived metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not overwrite archive-worker title on re-sync when TrackAudioFile exists", async () => {
    const trackUpsert = vi
      .fn()
      .mockImplementation(
        ({
          update,
          create,
        }: {
          update: Record<string, unknown>;
          create: Record<string, unknown>;
        }) => Promise.resolve({ id: "track-archived", ...(create.serviceUrl ? update : create) }),
      );

    const tx = {
      track: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "track-archived",
            title: "Archive Worker Title",
            artistId: "artist-1",
            albumId: "album-1",
            releaseDate: new Date("2020-01-01"),
            duration: 200,
            coverImageId: "cover-1",
            externalId: "video-archived",
            audioFiles: [{ id: "audio-1" }],
          },
        ]),
        upsert: trackUpsert,
      },
      artist: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: "artist-yt", name: "YouTube Artist" }),
        create: vi.fn(),
      },
      servicePlaylistTrack: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: "spt-1" }),
      },
    } as unknown as Prisma.TransactionClient;

    await processTracksInBatches(
      [
        {
          snippet: {
            title: "YouTube Re-sync Title",
            resourceId: { videoId: "video-archived" },
            videoOwnerChannelTitle: "YouTube Artist",
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

    expect(trackUpsert).toHaveBeenCalled();
    const update = trackUpsert.mock.calls[0]![0].update as { title?: string; artistId?: string };
    expect(update.title).toBe("Archive Worker Title");
    expect(update.artistId).toBe("artist-1");
  });
});

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

describe("processTracksInBatches - playlist track pairing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps playlist positions aligned when the safety filter drops a middle row", async () => {
    const playlistTrackUpsert = vi
      .fn()
      .mockImplementation(({ create }: { create: { position: number; trackId: string } }) =>
        Promise.resolve({ id: "spt", trackId: create.trackId, position: create.position }),
      );

    const trackUpsert = vi
      .fn()
      .mockImplementation(({ create }: { create: { externalId: string } }) =>
        Promise.resolve({
          id: `track-${create.externalId}`,
          title: create.externalId,
          externalId: create.externalId,
        }),
      );

    const tx = {
      track: { findMany: vi.fn().mockResolvedValue([]), upsert: trackUpsert },
      artist: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockImplementation(({ data }: { data: { name: string } }) =>
            Promise.resolve({ id: `artist-${data.name}`, name: data.name }),
          ),
      },
      servicePlaylistTrack: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: playlistTrackUpsert,
      },
      archiveJob: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    const items = [
      { snippet: { title: "A", resourceId: { videoId: "video-a" }, videoOwnerChannelTitle: "A" } },
      { snippet: { title: "B", resourceId: { videoId: "" }, videoOwnerChannelTitle: "B" } },
      {
        snippet: {
          title: "C",
          resourceId: { videoId: "video-c" },
          videoOwnerChannelTitle: "C",
          thumbnails: { default: { url: "https://example.com/c.jpg" } },
        },
      },
    ] as never[];

    await processTracksInBatches(
      items,
      "service-1",
      "playlist-1",
      tx,
      createYouTubeTrackSyncProcessor(),
      noopArchiveEnqueueAdapter,
      0,
    );

    const positions = playlistTrackUpsert.mock.calls.map(
      (call) => (call[0] as { create: { position: number } }).create.position,
    );
    expect(positions).toEqual([1, 3]);
    expect(trackUpsert).toHaveBeenCalledTimes(2);
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
