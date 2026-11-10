import { describe, expect, it, vi, beforeEach } from "vitest";
import { consoleError, consoleWarn } from "#tests/setup/setup-test-env.ts";
import { type Prisma } from "#prisma/client.js";
import { noopArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { processTracksInBatches } from "./batch-processor.server";
import {
  createYouTubeTrackSyncProcessor,
  type TrackSyncProcessor,
} from "./youtube-track-sync.server";

function createTxMock() {
  const artistCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: { name: string } }) =>
      Promise.resolve({ id: `artist-${data.name}`, name: data.name }),
    );
  const tx = {
    track: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
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
      create: vi.fn().mockResolvedValue({ id: "spt-1" }),
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

describe("processTracksInBatches - unavailable placeholders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves existing title for item-id-less unavailable rows matched by pending externalId", async () => {
    const trackUpsert = vi
      .fn()
      .mockImplementation(
        ({
          update,
          create,
        }: {
          update: Record<string, unknown>;
          create: Record<string, unknown>;
        }) =>
          Promise.resolve({
            id: "track-pending",
            title: (update.title as string | undefined) ?? create.title,
            externalId: create.externalId,
            serviceUrl: null,
          }),
      );

    const tx = {
      track: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "track-pending",
            title: "Original Title",
            artistId: "artist-real",
            albumId: null,
            releaseDate: null,
            duration: null,
            coverImageId: null,
            externalId: "pending-playlist-1-1",
            audioFiles: [],
          },
        ]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: trackUpsert,
      },
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
        create: vi.fn().mockResolvedValue({ id: "spt-1", trackId: "track-pending" }),
      },
      archiveJob: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    await processTracksInBatches(
      [
        {
          snippet: {
            title: "Deleted video",
            resourceId: {},
            videoOwnerChannelTitle: "Uploader",
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
    const { update } = trackUpsert.mock.calls[0]![0] as {
      update: { title?: string };
    };
    expect(update.title).toBe("Original Title");
  });

  it("does not bind id-less unavailable rows to a real video occupying the same position after reorder", async () => {
    const trackUpsert = vi.fn().mockResolvedValue({ id: "track-real" });

    const tx = {
      track: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: trackUpsert,
      },
      artist: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      servicePlaylistTrack: {
        findMany: vi.fn().mockResolvedValue([
          {
            position: 1,
            track: {
              id: "track-real",
              title: "Real Song",
              artistId: "artist-real",
              albumId: null,
              releaseDate: null,
              duration: 120,
              coverImageId: null,
              externalId: "dQw4w9WgXcQ",
              audioFiles: [{ id: "af-1" }],
            },
          },
        ]),
        upsert: vi.fn(),
      },
      archiveJob: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    await processTracksInBatches(
      [
        {
          snippet: {
            title: "Deleted video",
            resourceId: {},
            videoOwnerChannelTitle: "Uploader",
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

    expect(trackUpsert).not.toHaveBeenCalled();
  });
});

describe("processTracksInBatches - archived metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleError.mockImplementation(() => {});
  });

  it("does not overwrite file-derived metadata when audio appears after the batch snapshot", async () => {
    const trackUpsert = vi
      .fn()
      .mockImplementation(({ update }: { update: Record<string, unknown> }) =>
        Promise.resolve({ id: "track-archived", ...update }),
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
            audioFiles: [],
          },
        ]),
        findUnique: vi.fn().mockResolvedValue({
          title: "Archive Worker Title",
          artistId: "artist-1",
          albumId: "album-1",
          releaseDate: new Date("2020-01-01"),
          duration: 200,
          coverImageId: "cover-1",
          audioFiles: [{ id: "audio-1" }],
        }),
        upsert: trackUpsert,
      },
      artist: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "artist-yt", name: "YouTube Artist" }),
      },
      servicePlaylistTrack: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "spt-1" }),
      },
      archiveJob: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
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
    const update = trackUpsert.mock.calls[0]![0].update as {
      title?: string;
      artistId?: string;
      albumId?: string;
    };
    expect(update.title).toBe("Archive Worker Title");
    expect(update.artistId).toBe("artist-1");
    expect(update.albumId).toBe("album-1");
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
        }) =>
          Promise.resolve({
            id: "track-archived",
            ...(create.serviceUrl ? update : create),
          }),
      );

    const archivedRow = {
      title: "Archive Worker Title",
      artistId: "artist-1",
      albumId: "album-1",
      releaseDate: new Date("2020-01-01"),
      duration: 200,
      coverImageId: "cover-1",
      audioFiles: [{ id: "audio-1" }],
    };

    const tx = {
      track: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "track-archived",
            ...archivedRow,
            externalId: "video-archived",
          },
        ]),
        findUnique: vi.fn().mockResolvedValue(archivedRow),
        upsert: trackUpsert,
      },
      artist: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: "artist-yt", name: "YouTube Artist" }),
        create: vi.fn(),
      },
      servicePlaylistTrack: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "spt-1" }),
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
    const update = trackUpsert.mock.calls[0]![0].update as {
      title?: string;
      artistId?: string;
    };
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
    consoleWarn.mockImplementation(() => {});
    const playlistTrackUpsert = vi.fn().mockImplementation(
      ({
        data,
      }: {
        data: {
          position: number;
          trackId: string;
          thumbnailUrl?: string | null;
        };
      }) =>
        Promise.resolve({
          id: "spt",
          trackId: data.trackId,
          position: data.position,
          thumbnailUrl: data.thumbnailUrl ?? null,
        }),
    );

    const trackUpsert = vi
      .fn()
      .mockImplementation(({ create }: { create: { externalId: string; title: string } }) =>
        Promise.resolve({
          id: `track-${create.externalId}`,
          title: create.title,
          externalId: create.externalId,
          serviceUrl: "https://youtube.com/watch?v=" + create.externalId,
        }),
      );

    const tx = {
      track: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: trackUpsert,
      },
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
        create: playlistTrackUpsert,
      },
      archiveJob: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    const base = createYouTubeTrackSyncProcessor();
    const processor = {
      isUnavailableVideo: (item: never) => base.isUnavailableVideo(item),
      shouldPreserveTrackData: (existingTrack: never, newItem: never) =>
        base.shouldPreserveTrackData(existingTrack, newItem),
      transformPlaylistItem(item: never, serviceId: string, artistId: string) {
        const transformed = base.transformPlaylistItem(item, serviceId, artistId);
        if ((item as { snippet?: { title?: string } }).snippet?.title === "B") {
          return { ...transformed, externalId: "" };
        }
        return transformed;
      },
    } satisfies TrackSyncProcessor;

    const items = [
      {
        snippet: {
          title: "A",
          resourceId: { videoId: "video-a" },
          videoOwnerChannelTitle: "A",
          thumbnails: { default: { url: "https://example.com/a.jpg" } },
        },
      },
      {
        snippet: {
          title: "B",
          resourceId: { videoId: "video-b" },
          videoOwnerChannelTitle: "B",
          thumbnails: { default: { url: "https://example.com/b.jpg" } },
        },
      },
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
      processor,
      noopArchiveEnqueueAdapter,
      0,
    );

    const upsertCalls = playlistTrackUpsert.mock.calls.map(
      (call) => call[0] as { data: { position: number; thumbnailUrl?: string | null } },
    );
    expect(upsertCalls.map((call) => call.data.position)).toEqual([1, 3]);
    expect(upsertCalls.map((call) => call.data.thumbnailUrl)).toEqual([
      "https://example.com/a.jpg",
      "https://example.com/c.jpg",
    ]);
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
