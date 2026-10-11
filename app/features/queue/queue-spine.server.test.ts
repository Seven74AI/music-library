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
      value: {
        context: "library",
        hasAudioOnly: true,
        sort: "dateAdded",
        direction: "desc",
      },
    });
  });

  test("accepts library context with mostPlayedMonth sort", () => {
    const params = new URLSearchParams("context=library&hasAudio=1&sort=mostPlayedMonth");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "library",
        hasAudioOnly: true,
        sort: "mostPlayedMonth",
        direction: "desc",
      },
    });
  });

  test("accepts library context with ascending direction", () => {
    const params = new URLSearchParams("context=library&hasAudio=1&dir=asc");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "library",
        hasAudioOnly: true,
        sort: "dateAdded",
        direction: "asc",
      },
    });
  });

  test("defaults unknown library sort to dateAdded", () => {
    const params = new URLSearchParams("context=library&hasAudio=1&sort=nope");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "library",
        hasAudioOnly: true,
        sort: "dateAdded",
        direction: "desc",
      },
    });
  });

  test("accepts discover context and defaults sort to recently added", () => {
    const params = new URLSearchParams("context=discover");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "discover",
        sort: "recentlyAdded",
        direction: "desc",
      },
    });
  });

  test("accepts a discover sort and direction", () => {
    const params = new URLSearchParams("context=discover&sort=mostPlayed&dir=asc");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "discover",
        sort: "mostPlayed",
        direction: "asc",
      },
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
      value: {
        context: "playlist",
        playlistId: "pl-1",
        sort: "custom",
        direction: "asc",
      },
    });
  });

  test("accepts playlist context with sort", () => {
    const params = new URLSearchParams("context=playlist&playlistId=pl-1&sort=title");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "playlist",
        playlistId: "pl-1",
        sort: "title",
        direction: "asc",
      },
    });
  });

  test("accepts playlist context with descending direction", () => {
    const params = new URLSearchParams("context=playlist&playlistId=pl-1&sort=title&dir=desc");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "playlist",
        playlistId: "pl-1",
        sort: "title",
        direction: "desc",
      },
    });
  });

  test("defaults unknown playlist sort to custom", () => {
    const params = new URLSearchParams("context=playlist&playlistId=pl-1&sort=nope");
    expect(parseQueueSpineParams(params)).toEqual({
      ok: true,
      value: {
        context: "playlist",
        playlistId: "pl-1",
        sort: "custom",
        direction: "asc",
      },
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
      sort: "dateAdded",
      direction: "desc",
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
      sort: "dateAdded",
      direction: "desc",
    });

    expect(result).toEqual({ tracks: [], total: 0 });
  });

  test("returns playlist spine ordered by position", async () => {
    vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValue([
      {
        position: 0,
        createdAt: new Date("2024-01-01"),
        track: {
          id: "track-2",
          title: "Song Two",
          artist: { id: "artist-2", name: "Artist Two" },
          duration: 120,
        },
      },
    ] as never);

    const result = await fetchQueueSpine("user-1", {
      context: "playlist",
      playlistId: "pl-1",
      sort: "custom",
      direction: "asc",
    });

    expect(prisma.userPlaylistTrack.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          playlistId: "pl-1",
          playlist: { ownerId: "user-1" },
        },
        orderBy: { position: "asc" },
        select: {
          position: true,
          createdAt: true,
          track: {
            select: {
              ...QUEUE_TRACK_SELECT,
              duration: true,
            },
          },
        },
      }),
    );
    expect(result.total).toBe(1);
    expect(result.tracks[0]).toEqual({
      id: "track-2",
      title: "Song Two",
      artist: { id: "artist-2", name: "Artist Two" },
    });
    expect(result.tracks[0]).not.toHaveProperty("audioFiles");
  });

  test("returns playlist spine sorted by title when sort=title", async () => {
    vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValue([
      {
        position: 0,
        createdAt: new Date("2024-01-01"),
        track: {
          id: "track-z",
          title: "Zebra",
          artist: { id: "artist-1", name: "A" },
          duration: 100,
        },
      },
      {
        position: 1,
        createdAt: new Date("2024-01-02"),
        track: {
          id: "track-a",
          title: "Apple",
          artist: { id: "artist-2", name: "B" },
          duration: 200,
        },
      },
    ] as never);

    const result = await fetchQueueSpine("user-1", {
      context: "playlist",
      playlistId: "pl-1",
      sort: "title",
      direction: "asc",
    });

    expect(result.tracks.map((track) => track.id)).toEqual(["track-a", "track-z"]);
  });

  test("returns the full artist discography (no 50-track cap)", async () => {
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
    });
    // Regression guard: the artist context must return the full discography,
    // not cap the spine at 50 tracks (library/playlist/album return every track).
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
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

  test("returns the playable discover catalog without a page cap", async () => {
    vi.mocked(prisma.track.findMany).mockResolvedValue([
      {
        id: "track-d",
        title: "Discover Song",
        createdAt: new Date("2024-01-01"),
        artist: { id: "artist-d", name: "Discover Artist" },
      },
    ] as never);

    const result = await fetchQueueSpine("user-1", {
      context: "discover",
      sort: "recentlyAdded",
      direction: "desc",
    });

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { audioFiles: { some: {} } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
    expect(result).toEqual({
      tracks: [
        {
          id: "track-d",
          title: "Discover Song",
          artist: { id: "artist-d", name: "Discover Artist" },
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
