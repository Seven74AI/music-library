import { describe, expect, test, vi, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { loader } from "./$trackId.history.tsx";

vi.mock("#app/utils/auth.server.ts", () => ({
  requireUserId: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    track: {
      findUnique: vi.fn(),
    },
    trackEdit: {
      findMany: vi.fn(),
    },
    artist: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    album: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    coverImage: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

function makeRequest(params: any) {
  return {
    request: new Request("http://localhost/api/metadata/tracks/track-1/history"),
    params,
    url: new URL("http://localhost/api/metadata/tracks/track-1/history"),
  };
}

describe("GET /api/metadata/tracks/:trackId/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUserId).mockResolvedValue("user-1");
  });

  test("requires authentication", async () => {
    vi.mocked(requireUserId).mockRejectedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    await expect(loader(makeRequest({ trackId: "track-1" }) as never)).rejects.toThrow();

    expect(requireUserId).toHaveBeenCalled();
  });

  test("validates track exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue(null);

    try {
      await loader(makeRequest({ trackId: "track-1" }) as never);
      expect.unreachable("loader should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Track not found");
    }
  });

  test("returns empty history for track with no edits", async () => {
    vi.mocked(prisma.track.findUnique)
      .mockResolvedValueOnce({ id: "track-1" } as never)
      .mockResolvedValueOnce({
        title: "Track Title",
        artistId: "artist-1",
        albumId: null,
        genre: "Rock",
        year: 2020,
        trackNumber: 1,
        albumArtist: null,
        bpm: null,
        label: null,
        isrc: null,
        releaseDate: null,
        originalDate: null,
        originalYear: null,
        totalTracks: null,
        totalDiscs: null,
        lyrics: null,
      } as never);
    vi.mocked(prisma.trackEdit.findMany).mockResolvedValue([]);

    const response: any = await loader(makeRequest({ trackId: "track-1" }) as never);

    expect(response.data.history).toEqual([]);
  });

  test("returns history with computed changes", async () => {
    const currentTrack = {
      title: "New Title",
      artistId: "artist-2",
      albumId: "album-1",
      genre: "Jazz",
      year: 2021,
      trackNumber: 2,
      albumArtist: "Album Artist",
      bpm: 120,
      label: "New Label",
      isrc: "ISRC456",
      releaseDate: new Date("2021-01-01"),
      originalDate: null,
      originalYear: null,
      totalTracks: 10,
      totalDiscs: 1,
      lyrics: "New lyrics",
    };

    const edit1 = {
      id: "edit-1",
      trackId: "track-1",
      editedBy: "user-1",
      editedAt: new Date("2021-06-01"),
      comment: "Updated title and genre",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      year: 2020,
      trackNumber: 1,
      albumArtist: null,
      bpm: null,
      label: "Old Label",
      isrc: "ISRC123",
      releaseDate: new Date("2020-01-01"),
      originalDate: null,
      originalYear: null,
      totalTracks: null,
      totalDiscs: null,
      lyrics: null,
      user: {
        id: "user-1",
        username: "curator",
        name: "Curator User",
      },
    };

    const edit2 = {
      id: "edit-2",
      trackId: "track-1",
      editedBy: "user-2",
      editedAt: new Date("2021-01-01"),
      comment: "Initial metadata",
      title: "Original Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Unknown",
      year: 2019,
      trackNumber: 1,
      albumArtist: null,
      bpm: null,
      label: null,
      isrc: null,
      releaseDate: null,
      originalDate: null,
      originalYear: null,
      totalTracks: null,
      totalDiscs: null,
      lyrics: null,
      user: {
        id: "user-2",
        username: "admin",
        name: "Admin User",
      },
    };

    vi.mocked(prisma.track.findUnique)
      .mockResolvedValueOnce({ id: "track-1" } as never)
      .mockResolvedValueOnce(currentTrack as never);
    vi.mocked(prisma.trackEdit.findMany).mockResolvedValue([edit1, edit2] as never);

    const response: any = await loader(makeRequest({ trackId: "track-1" }) as never);

    expect(response.data.history).toHaveLength(2);

    // First edit (most recent) should show changes from edit1 to current
    const history1 = response.data.history[0];
    expect(history1.id).toBe("edit-1");
    expect(history1.editedBy.username).toBe("curator");
    expect(history1.comment).toBe("Updated title and genre");
    expect(history1.changes.title).toEqual({ from: "Old Title", to: "New Title" });
    expect(history1.changes.genre).toEqual({ from: "Rock", to: "Jazz" });
    expect(history1.changes.artistId).toEqual({ from: "artist-1", to: "artist-2" });

    // Second edit should show changes from edit2 to edit1
    const history2 = response.data.history[1];
    expect(history2.id).toBe("edit-2");
    expect(history2.editedBy.username).toBe("admin");
    expect(history2.changes.title).toEqual({ from: "Original Title", to: "Old Title" });
    expect(history2.changes.genre).toEqual({ from: "Unknown", to: "Rock" });
    expect(history2.changes.year).toEqual({ from: 2019, to: 2020 });
    expect(history1.labels?.artistId).toEqual({
      from: "Unknown artist",
      to: "Unknown artist",
    });
  });

  test("labels artist and album changes with their names", async () => {
    vi.mocked(prisma.artist.findMany).mockResolvedValue([
      { id: "artist-1", name: "Bill Evans" },
      { id: "artist-2", name: "Miles Davis" },
    ] as never);
    vi.mocked(prisma.album.findMany).mockResolvedValue([
      { id: "album-1", name: "Kind of Blue" },
    ] as never);

    const currentTrack = {
      title: "New Title",
      artistId: "artist-2",
      albumId: "album-1",
      genre: "Jazz",
      year: 2021,
      trackNumber: 1,
      albumArtist: null,
      bpm: null,
      label: null,
      isrc: null,
      releaseDate: null,
      originalDate: null,
      originalYear: null,
      totalTracks: null,
      totalDiscs: null,
      lyrics: null,
    };
    const edit = {
      id: "edit-1",
      editedAt: new Date("2021-06-01"),
      comment: "Fixed the credit",
      title: "New Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Jazz",
      year: 2021,
      trackNumber: 1,
      albumArtist: null,
      bpm: null,
      label: null,
      isrc: null,
      releaseDate: null,
      originalDate: null,
      originalYear: null,
      totalTracks: null,
      totalDiscs: null,
      lyrics: null,
      user: { id: "user-1", username: "curator", name: "Curator" },
    };

    vi.mocked(prisma.track.findUnique)
      .mockResolvedValueOnce({ id: "track-1" } as never)
      .mockResolvedValueOnce(currentTrack as never);
    vi.mocked(prisma.trackEdit.findMany).mockResolvedValue([edit] as never);

    const response: any = await loader(makeRequest({ trackId: "track-1" }) as never);
    const history = response.data.history[0];

    expect(history.changes.artistId).toEqual({ from: "artist-1", to: "artist-2" });
    expect(history.labels.artistId).toEqual({ from: "Bill Evans", to: "Miles Davis" });
    expect(history.labels.albumId).toEqual({ from: "(empty)", to: "Kind of Blue" });
  });

  test("handles null and undefined values in changes", async () => {
    const currentTrack = {
      title: "Title",
      artistId: "artist-1",
      albumId: "album-1",
      genre: null,
      year: null,
      trackNumber: null,
      albumArtist: null,
      bpm: null,
      label: null,
      isrc: null,
      releaseDate: null,
      originalDate: null,
      originalYear: null,
      totalTracks: null,
      totalDiscs: null,
      lyrics: null,
    };

    const edit1 = {
      id: "edit-1",
      trackId: "track-1",
      editedBy: "user-1",
      editedAt: new Date("2021-01-01"),
      comment: "Cleared metadata",
      title: "Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      year: 2020,
      trackNumber: 1,
      albumArtist: "Album Artist",
      bpm: 120,
      label: "Label",
      isrc: "ISRC123",
      releaseDate: new Date("2020-01-01"),
      originalDate: null,
      originalYear: null,
      totalTracks: 10,
      totalDiscs: 1,
      lyrics: "Lyrics",
      user: {
        id: "user-1",
        username: "curator",
        name: "Curator",
      },
    };

    vi.mocked(prisma.track.findUnique)
      .mockResolvedValueOnce({ id: "track-1" } as never)
      .mockResolvedValueOnce(currentTrack as never);
    vi.mocked(prisma.trackEdit.findMany).mockResolvedValue([edit1] as never);

    const response: any = await loader(makeRequest({ trackId: "track-1" }) as never);

    expect(response.data.history).toHaveLength(1);

    const history = response.data.history[0];
    expect(history.changes.albumId).toEqual({ from: null, to: "album-1" });
    expect(history.changes.genre).toEqual({ from: "Rock", to: null });
    expect(history.changes.year).toEqual({ from: 2020, to: null });
    expect(history.changes.bpm).toEqual({ from: 120, to: null });
  });

  test("handles date fields correctly", async () => {
    const currentTrack = {
      title: "Title",
      artistId: "artist-1",
      albumId: null,
      genre: null,
      year: null,
      trackNumber: null,
      albumArtist: null,
      bpm: null,
      label: null,
      isrc: null,
      releaseDate: new Date("2021-06-01"),
      originalDate: new Date("2021-01-01"),
      originalYear: null,
      totalTracks: null,
      totalDiscs: null,
      lyrics: null,
    };

    const edit1 = {
      id: "edit-1",
      trackId: "track-1",
      editedBy: "user-1",
      editedAt: new Date("2021-02-01"),
      comment: "Updated dates",
      title: "Title",
      artistId: "artist-1",
      albumId: null,
      genre: null,
      year: null,
      trackNumber: null,
      albumArtist: null,
      bpm: null,
      label: null,
      isrc: null,
      releaseDate: new Date("2020-01-01"),
      originalDate: null,
      originalYear: null,
      totalTracks: null,
      totalDiscs: null,
      lyrics: null,
      user: {
        id: "user-1",
        username: "curator",
        name: "Curator",
      },
    };

    vi.mocked(prisma.track.findUnique)
      .mockResolvedValueOnce({ id: "track-1" } as never)
      .mockResolvedValueOnce(currentTrack as never);
    vi.mocked(prisma.trackEdit.findMany).mockResolvedValue([edit1] as never);

    const response: any = await loader(makeRequest({ trackId: "track-1" }) as never);

    expect(response.data.history).toHaveLength(1);

    const history = response.data.history[0];
    expect(history.changes.releaseDate).toBeDefined();
    expect(history.changes.releaseDate.from).toBe("2020-01-01T00:00:00.000Z");
    expect(history.changes.releaseDate.to).toBe("2021-06-01T00:00:00.000Z");
    expect(history.changes.originalDate).toBeDefined();
    expect(history.changes.originalDate.from).toBeNull();
    expect(history.changes.originalDate.to).toBe("2021-01-01T00:00:00.000Z");
  });
});
