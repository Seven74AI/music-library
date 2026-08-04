import { describe, expect, test, vi, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  fetchQueueSpine,
  parseQueueSpineParams,
  QUEUE_TRACK_SELECT,
} from "./queue-spine.server.ts";

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    userTrack: {
      findMany: vi.fn(),
    },
    userPlaylistTrack: {
      findMany: vi.fn(),
    },
    track: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe("parseQueueSpineParams", () => {
  test("accepts library context with hasAudio=1", () => {
    const params = new URLSearchParams("context=library&hasAudio=1");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: { context: "library", hasAudioOnly: true },
    });
  });

  test("rejects missing context", () => {
    const params = new URLSearchParams("hasAudio=1");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Invalid context parameter",
    });
  });

  test("rejects invalid context", () => {
    const params = new URLSearchParams("context=bogus");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Invalid context parameter",
    });
  });

  test("rejects library context without hasAudio=1", () => {
    const params = new URLSearchParams("context=library");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Invalid hasAudio parameter",
    });
  });

  test("rejects library context with invalid hasAudio value", () => {
    const params = new URLSearchParams("context=library&hasAudio=true");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Invalid hasAudio parameter",
    });
  });

  test("accepts playlist context with playlistId", () => {
    const params = new URLSearchParams("context=playlist&playlistId=pl-1");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: { context: "playlist", playlistId: "pl-1" },
    });
  });

  test("rejects playlist context without playlistId", () => {
    const params = new URLSearchParams("context=playlist");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Playlist ID is required",
    });
  });

  test("accepts artist context with artistId", () => {
    const params = new URLSearchParams("context=artist&artistId=artist-1");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: { context: "artist", artistId: "artist-1" },
    });
  });

  test("rejects artist context without artistId", () => {
    const params = new URLSearchParams("context=artist");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Artist ID is required",
    });
  });

  test("accepts album context with albumId", () => {
    const params = new URLSearchParams("context=album&albumId=album-1");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: { context: "album", albumId: "album-1" },
    });
  });

  test("rejects album context without albumId", () => {
    const params = new URLSearchParams("context=album");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Album ID is required",
    });
  });

  test("accepts track context with trackId", () => {
    const params = new URLSearchParams("context=track&trackId=track-1");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: { context: "track", trackId: "track-1" },
    });
  });

  test("rejects track context without trackId", () => {
    const params = new URLSearchParams("context=track");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: false,
      error: "Track ID is required",
    });
  });
});

describe("fetchQueueSpine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns library spine with minimal projection and total", async () => {
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([
      {
        track: {
          id: "track-1",
          title: "Song One",
          artist: { id: "artist-1", name: "Artist One" },
        },
      },
    ] as never);

    const result = await fetchQueueSpine("user-1", {
      context: "library",
      hasAudioOnly: true,
    });

    expect(prisma.userTrack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { track: { select: QUEUE_TRACK_SELECT } },
      }),
    );
    expect(result).toEqual({
      tracks: [
        {
          id: "track-1",
          title: "Song One",
          artist: { id: "artist-1", name: "Artist One" },
        },
      ],
      total: 1,
    });
    expect(result.tracks[0]).not.toHaveProperty("audioFiles");
  });

  test("returns empty library spine", async () => {
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);

    const result = await fetchQueueSpine("user-1", {
      context: "library",
      hasAudioOnly: true,
    });

    expect(result).toEqual({ tracks: [], total: 0 });
  });

  test("returns playlist spine ordered by position", async () => {
    vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValue([
      {
        track: {
          id: "track-2",
          title: "Song Two",
          artist: { id: "artist-2", name: "Artist Two" },
        },
      },
    ] as never);

    const result = await fetchQueueSpine("user-1", {
      context: "playlist",
      playlistId: "pl-1",
    });

    expect(prisma.userPlaylistTrack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          playlistId: "pl-1",
          playlist: { ownerId: "user-1" },
        },
        orderBy: { position: "asc" },
        select: { track: { select: QUEUE_TRACK_SELECT } },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.tracks[0]).not.toHaveProperty("audioFiles");
  });

  test("returns artist spine ordered like the artist page", async () => {
    vi.mocked(prisma.track.findMany).mockResolvedValue([
      {
        id: "track-3",
        title: "Newest Artist Song",
        artist: { id: "artist-3", name: "Artist Three" },
      },
    ] as never);

    const result = await fetchQueueSpine("user-1", {
      context: "artist",
      artistId: "artist-3",
    });

    expect(prisma.track.findMany).toHaveBeenCalledWith({
      where: { artistId: "artist-3" },
      select: QUEUE_TRACK_SELECT,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(result).toEqual({
      tracks: [
        {
          id: "track-3",
          title: "Newest Artist Song",
          artist: { id: "artist-3", name: "Artist Three" },
        },
      ],
      total: 1,
    });
  });

  test("returns album spine ordered like the album page", async () => {
    vi.mocked(prisma.track.findMany).mockResolvedValue([
      {
        id: "track-4",
        title: "Album Opener",
        artist: { id: "artist-4", name: "Artist Four" },
      },
    ] as never);

    const result = await fetchQueueSpine("user-1", {
      context: "album",
      albumId: "album-4",
    });

    expect(prisma.track.findMany).toHaveBeenCalledWith({
      where: { albumId: "album-4" },
      select: QUEUE_TRACK_SELECT,
      orderBy: { createdAt: "asc" },
    });
    expect(result).toEqual({
      tracks: [
        {
          id: "track-4",
          title: "Album Opener",
          artist: { id: "artist-4", name: "Artist Four" },
        },
      ],
      total: 1,
    });
  });

  test("returns a one-track spine for track context", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-5",
      title: "Only Track",
      artist: { id: "artist-5", name: "Artist Five" },
    } as never);

    const result = await fetchQueueSpine("user-1", {
      context: "track",
      trackId: "track-5",
    });

    expect(prisma.track.findUnique).toHaveBeenCalledWith({
      where: { id: "track-5" },
      select: QUEUE_TRACK_SELECT,
    });
    expect(result).toEqual({
      tracks: [
        {
          id: "track-5",
          title: "Only Track",
          artist: { id: "artist-5", name: "Artist Five" },
        },
      ],
      total: 1,
    });
  });
});
