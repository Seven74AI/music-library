import { describe, expect, test, vi, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { action } from "./$trackId.restore.$editId.tsx";

vi.mock("#app/utils/permissions.server.ts", () => ({
  requireCuratorRole: vi.fn(),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    track: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    artist: {
      findUnique: vi.fn(),
    },
    album: {
      findUnique: vi.fn(),
    },
    trackEdit: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    genre: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

function makeRequest(body: any, params: any) {
  return {
    request: new Request("http://localhost/api/metadata/tracks/track-1/restore/edit-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  };
}

describe("POST /api/metadata/tracks/:trackId/restore/:editId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCuratorRole).mockResolvedValue("user-1");
  });

  test("requires curator or admin role", async () => {
    vi.mocked(requireCuratorRole).mockRejectedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 }),
    );

    const body = {
      comment: "Restoring to previous version",
    };

    await expect(
      action(makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never),
    ).rejects.toThrow();

    expect(requireCuratorRole).toHaveBeenCalled();
  });

  test("requires comment field", async () => {
    const body = {};

    try {
      await action(makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      // Data is in e.data
      expect(e.data.error).toBe("Validation failed");
    }
  });

  test("validates track exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue(null);

    const body = {
      comment: "Restoring to previous version",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Track not found");
    }
  });

  test("validates edit exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
    } as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue(null);

    const body = {
      comment: "Restoring to previous version",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Edit not found");
    }
  });

  test("validates edit belongs to track", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
    } as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue({
      id: "edit-1",
      trackId: "track-2", // Different track
      title: "Old Title",
      artistId: "artist-1",
    } as never);

    const body = {
      comment: "Restoring to previous version",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      // Data is in e.data
      expect(e.data.error).toBe("Edit does not belong to this track");
    }
  });

  test("validates artist from restored version exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
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
    } as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue({
      id: "edit-1",
      trackId: "track-1",
      title: "Old Title",
      artistId: "artist-2",
      albumId: null,
      genre: "Jazz",
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
    vi.mocked(prisma.artist.findUnique).mockResolvedValue(null);

    const body = {
      comment: "Restoring to previous version",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Artist from restored version no longer exists");
    }
  });

  test("validates album from restored version exists if provided", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
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
    } as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue({
      id: "edit-1",
      trackId: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: "album-1",
      genre: "Jazz",
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
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.album.findUnique).mockResolvedValue(null);

    const body = {
      comment: "Restoring to previous version",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Album from restored version no longer exists");
    }
  });

  test("creates edit history and restores track", async () => {
    const currentTrack = {
      id: "track-1",
      title: "Current Title",
      artistId: "artist-2",
      albumId: "album-1",
      genre: "Rock",
      year: 2021,
      trackNumber: 2,
      albumArtist: "Album Artist",
      bpm: 120,
      label: "Label",
      isrc: "ISRC456",
      releaseDate: new Date("2021-01-01"),
      originalDate: null,
      originalYear: null,
      totalTracks: 10,
      totalDiscs: 1,
      lyrics: "Current lyrics",
    };

    const editToRestore = {
      id: "edit-1",
      trackId: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Jazz",
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
    };

    const restoredTrack = {
      ...currentTrack,
      ...editToRestore,
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: null,
    };

    const { id: _trackId, ...trackFields } = currentTrack;
    const newEditEntry = {
      id: "edit-2",
      trackId: "track-1",
      editedBy: "user-1",
      editedAt: new Date(),
      comment: "Restore to version edit-1: Reverting recent changes",
      ...trackFields,
      user: {
        id: "user-1",
        username: "curator",
        name: "Curator User",
      },
    };

    vi.mocked(prisma.track.findUnique).mockResolvedValue(currentTrack as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue(editToRestore as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue({
      track: restoredTrack,
      edit: newEditEntry,
    } as never);

    const body = {
      comment: "Reverting recent changes",
    };

    const response: any = await action(
      makeRequest(body, { trackId: "track-1", editId: "edit-1" }) as never,
    );

    expect(response.data.track.title).toBe("Old Title");
    expect(response.data.track.artistId).toBe("artist-1");
    expect(response.data.track.year).toBe(2020);
    expect(response.data.edit).toBeDefined();
    expect(response.data.edit.comment).toContain("Restore to version");
  });

  test("restores previous genre ids onto the track relation", async () => {
    const currentTrack = {
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      genres: [
        { id: "genre-pop", name: "Pop" },
        { id: "genre-rock", name: "Rock" },
      ],
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

    const editToRestore = {
      id: "edit-1",
      trackId: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Jazz",
      genreIds: JSON.stringify(["genre-jazz", "genre-soul"]),
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
    };

    vi.mocked(prisma.track.findUnique).mockResolvedValue(currentTrack as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue(editToRestore as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.genre.findMany).mockResolvedValue([
      { id: "genre-soul", name: "Soul" },
      { id: "genre-jazz", name: "Jazz" },
    ] as never);

    const mockTrackEditCreate = vi.fn().mockResolvedValue({
      id: "edit-2",
      comment: "Restore to version edit-1: Put the old tags back",
      user: { id: "user-1", username: "curator", name: "Curator User" },
    });
    const mockTrackUpdate = vi.fn().mockResolvedValue({
      ...currentTrack,
      title: "Old Title",
      genre: "Jazz",
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: null,
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      return callback({
        trackEdit: { create: mockTrackEditCreate },
        track: { update: mockTrackUpdate },
      });
    });

    const response: any = await action(
      makeRequest(
        { comment: "Put the old tags back" },
        { trackId: "track-1", editId: "edit-1" },
      ) as never,
    );

    expect(response.data.track.title).toBe("Old Title");
    expect(mockTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "track-1" },
        data: expect.objectContaining({
          title: "Old Title",
          genre: "Jazz",
          genres: { set: [{ id: "genre-jazz" }, { id: "genre-soul" }] },
        }),
      }),
    );
    expect(mockTrackEditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          genre: "Rock",
          genreIds: JSON.stringify(["genre-rock", "genre-pop"]),
        }),
      }),
    );
  });

  test("does not replace genre tags when the snapshot has no genre ids", async () => {
    const currentTrack = {
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      genres: [{ id: "genre-rock", name: "Rock" }],
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

    vi.mocked(prisma.track.findUnique).mockResolvedValue(currentTrack as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue({
      id: "edit-1",
      trackId: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Jazz",
      genreIds: null,
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
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);

    const mockTrackUpdate = vi.fn().mockResolvedValue({
      title: "Old Title",
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: null,
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      return callback({
        trackEdit: { create: vi.fn().mockResolvedValue({ id: "edit-2", user: {} }) },
        track: { update: mockTrackUpdate },
      });
    });

    await action(
      makeRequest(
        { comment: "Restore title only" },
        { trackId: "track-1", editId: "edit-1" },
      ) as never,
    );

    const updateCall = mockTrackUpdate.mock.calls[0]?.[0];
    expect(updateCall.data.genre).toBe("Jazz");
    expect(updateCall.data.genres).toBeUndefined();
    expect(prisma.genre.findMany).not.toHaveBeenCalled();
  });

  test("clears genre tags when the snapshot genre ids are empty", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      genres: [{ id: "genre-rock", name: "Rock" }],
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
    } as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue({
      id: "edit-1",
      trackId: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Jazz",
      genreIds: JSON.stringify([]),
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
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);

    const mockTrackUpdate = vi.fn().mockResolvedValue({
      title: "Old Title",
      genre: null,
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: null,
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      return callback({
        trackEdit: { create: vi.fn().mockResolvedValue({ id: "edit-2", user: {} }) },
        track: { update: mockTrackUpdate },
      });
    });

    await action(
      makeRequest(
        { comment: "Clear the old tags" },
        { trackId: "track-1", editId: "edit-1" },
      ) as never,
    );

    expect(mockTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          genre: null,
          genres: { set: [] },
        }),
      }),
    );
  });

  test("rejects a restore when a snapshotted genre no longer exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Current Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      genres: [{ id: "genre-rock", name: "Rock" }],
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
    } as never);
    vi.mocked(prisma.trackEdit.findUnique).mockResolvedValue({
      id: "edit-1",
      trackId: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Jazz",
      genreIds: JSON.stringify(["genre-jazz", "genre-gone"]),
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
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.genre.findMany).mockResolvedValue([
      { id: "genre-jazz", name: "Jazz" },
    ] as never);

    try {
      await action(
        makeRequest(
          { comment: "Restore missing genre" },
          { trackId: "track-1", editId: "edit-1" },
        ) as never,
      );
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      expect(e.data.error).toBe("One or more genres from the restored version no longer exist");
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("rejects non-POST requests", async () => {
    const request = {
      request: new Request("http://localhost/api/metadata/tracks/track-1/restore/edit-1", {
        method: "GET",
      }),
      params: { trackId: "track-1", editId: "edit-1" },
    };

    try {
      await action(request as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(405);
      // Data is in e.data
      expect(e.data.error).toBe("Method not allowed");
    }
  });

  test("handles invalid JSON body", async () => {
    const request = {
      request: new Request("http://localhost/api/metadata/tracks/track-1/restore/edit-1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      }),
      params: { trackId: "track-1", editId: "edit-1" },
    };

    try {
      await action(request as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      // Data is in e.data
      expect(e.data.error).toBe("Invalid JSON body");
    }
  });
});
