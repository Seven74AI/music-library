import { describe, expect, test, vi, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { action } from "./$trackId.edit.tsx";

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
      create: vi.fn(),
    },
    genre: {
      findMany: vi.fn(),
    },
    editLock: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

function makeRequest(body: any, params: any) {
  return {
    request: new Request("http://localhost/api/metadata/tracks/track-1/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  };
}

describe("POST /api/metadata/tracks/:trackId/edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCuratorRole).mockResolvedValue("user-1");
    vi.mocked(prisma.editLock.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.editLock.findUnique).mockResolvedValue(null);
  });

  test("requires curator or admin role", async () => {
    vi.mocked(requireCuratorRole).mockRejectedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403 }),
    );

    const body = {
      title: "New Title",
      artistId: "artist-1",
    };

    await expect(action(makeRequest(body, { trackId: "track-1" }) as never)).rejects.toThrow();

    expect(requireCuratorRole).toHaveBeenCalled();
  });

  test("validates required fields", async () => {
    const body = {
      title: "",
      artistId: "",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(400);
      expect(e.data.error).toBe("Validation failed");
    }
  });

  test("validates track exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue(null);

    const body = {
      title: "New Title",
      artistId: "artist-1",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Track not found");
    }
  });

  test("validates artist exists", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Old Title",
      artistId: "artist-1",
    } as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue(null);

    const body = {
      title: "New Title",
      artistId: "artist-2",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Artist not found");
    }
  });

  test("validates album exists if provided", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
    } as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.album.findUnique).mockResolvedValue(null);

    const body = {
      title: "New Title",
      artistId: "artist-1",
      albumId: "album-1",
    };

    try {
      await action(makeRequest(body, { trackId: "track-1" }) as never);
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(404);
      // Data is in e.data
      expect(e.data.error).toBe("Album not found");
    }
  });

  test("creates edit history and updates track", async () => {
    const existingTrack = {
      id: "track-1",
      title: "Old Title",
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
    };

    const updatedTrack = {
      ...existingTrack,
      title: "New Title",
      year: 2021,
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: null,
    };

    const { id: _trackId, ...trackFields } = existingTrack;
    const editEntry = {
      id: "edit-1",
      trackId: "track-1",
      editedBy: "user-1",
      editedAt: new Date(),
      comment: "Updated title and year",
      ...trackFields,
      user: {
        id: "user-1",
        username: "curator",
        name: "Curator User",
      },
    };

    vi.mocked(prisma.track.findUnique).mockResolvedValue(existingTrack as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue({
      track: updatedTrack,
      edit: editEntry,
    } as never);

    const body = {
      title: "New Title",
      artistId: "artist-1",
      year: 2021,
      comment: "Updated title and year",
    };

    const response: any = await action(makeRequest(body, { trackId: "track-1" }) as never);

    expect(response.data.track.title).toBe("New Title");
    expect(response.data.track.year).toBe(2021);
    expect(response.data.edit).toBeDefined();
  });

  test("handles nullable fields correctly", async () => {
    const existingTrack = {
      id: "track-1",
      title: "Title",
      artistId: "artist-1",
      albumId: "album-1",
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
    };

    const updatedTrack = {
      ...existingTrack,
      albumId: null,
      genre: null,
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: null,
    };

    const { id: _trackId2, ...trackFields2 } = existingTrack;
    const editEntry = {
      id: "edit-1",
      trackId: "track-1",
      editedBy: "user-1",
      editedAt: new Date(),
      comment: null,
      ...trackFields2,
      user: {
        id: "user-1",
        username: "curator",
        name: "Curator User",
      },
    };

    vi.mocked(prisma.track.findUnique).mockResolvedValue(existingTrack as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue({
      track: updatedTrack,
      edit: editEntry,
    } as never);

    const body = {
      title: "Title",
      artistId: "artist-1",
      albumId: null,
      genre: null,
    };

    const response: any = await action(makeRequest(body, { trackId: "track-1" }) as never);

    expect(response.data.track.albumId).toBeNull();
    expect(response.data.track.genre).toBeNull();
  });

  test("writes the selected album id onto the track", async () => {
    const existingTrack = {
      id: "track-1",
      title: "Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      genres: [],
      year: 2020,
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

    vi.mocked(prisma.track.findUnique).mockResolvedValue(existingTrack as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.album.findUnique).mockResolvedValue({ id: "album-2" } as never);

    const mockTrackUpdate = vi.fn().mockResolvedValue({
      ...existingTrack,
      albumId: "album-2",
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: { id: "album-2", name: "Kind of Blue" },
      genres: [],
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      return callback({
        trackEdit: {
          create: vi.fn().mockResolvedValue({ id: "edit-1" }),
        },
        track: {
          update: mockTrackUpdate,
        },
      });
    });

    const response: any = await action(
      makeRequest(
        {
          title: "Title",
          artistId: "artist-1",
          albumId: "album-2",
        },
        { trackId: "track-1" },
      ) as never,
    );

    expect(prisma.album.findUnique).toHaveBeenCalledWith({
      where: { id: "album-2" },
      select: { id: true },
    });
    expect(mockTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "track-1" },
        data: expect.objectContaining({ albumId: "album-2" }),
      }),
    );
    expect(response.data.track.albumId).toBe("album-2");
  });

  test("snapshots current genre ids and syncs the legacy genre string from genreIds", async () => {
    const existingTrack = {
      id: "track-1",
      title: "Old Title",
      artistId: "artist-1",
      albumId: null,
      genre: "Rock",
      genres: [
        { id: "genre-pop", name: "Pop" },
        { id: "genre-rock", name: "Rock" },
      ],
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

    vi.mocked(prisma.track.findUnique).mockResolvedValue(existingTrack as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.genre.findMany).mockResolvedValue([
      { id: "genre-soul", name: "Soul" },
      { id: "genre-jazz", name: "Jazz" },
    ] as never);

    const mockTrackEditCreate = vi.fn().mockResolvedValue({
      id: "edit-1",
      user: { id: "user-1", username: "curator", name: "Curator User" },
    });
    const mockTrackUpdate = vi.fn().mockResolvedValue({
      ...existingTrack,
      title: "New Title",
      genre: "Jazz",
      artist: { id: "artist-1", name: "Artist Name" },
      albumRecord: null,
      genres: [
        { id: "genre-jazz", name: "Jazz" },
        { id: "genre-soul", name: "Soul" },
      ],
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      return callback({
        trackEdit: { create: mockTrackEditCreate },
        track: { update: mockTrackUpdate },
      });
    });

    await action(
      makeRequest(
        {
          title: "New Title",
          artistId: "artist-1",
          genreIds: ["genre-jazz", "genre-soul"],
        },
        { trackId: "track-1" },
      ) as never,
    );

    expect(mockTrackEditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          genre: "Rock",
          genreIds: JSON.stringify(["genre-rock", "genre-pop"]),
        }),
      }),
    );
    expect(mockTrackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          genre: "Jazz",
          genres: { set: [{ id: "genre-jazz" }, { id: "genre-soul" }] },
        }),
      }),
    );
  });

  test("rejects non-POST requests", async () => {
    const request = {
      request: new Request("http://localhost/api/metadata/tracks/track-1/edit", {
        method: "GET",
      }),
      params: { trackId: "track-1" },
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

  test("rejects an edit while another curator holds the lock", async () => {
    vi.mocked(prisma.track.findUnique).mockResolvedValue({
      id: "track-1",
      title: "Old Title",
      artistId: "artist-1",
    } as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.editLock.findUnique).mockResolvedValue({
      id: "lock-1",
      entityType: "track",
      entityId: "track-1",
      lockedBy: "other-user",
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "other-user", name: "Ada", username: "ada" },
    } as never);

    try {
      await action(
        makeRequest({ title: "Overwrite", artistId: "artist-1" }, { trackId: "track-1" }) as never,
      );
      expect.unreachable("action should have thrown");
    } catch (e: any) {
      expect(e.init.status).toBe(409);
      expect(e.data.error).toBe("Locked");
      expect(e.data.message).toBe("Ada is currently editing this track");
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("releases the lock after a successful save", async () => {
    const existingTrack = {
      id: "track-1",
      title: "Old Title",
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
    };

    vi.mocked(prisma.track.findUnique).mockResolvedValue(existingTrack as never);
    vi.mocked(prisma.artist.findUnique).mockResolvedValue({ id: "artist-1" } as never);
    vi.mocked(prisma.editLock.findUnique).mockResolvedValue({
      id: "lock-1",
      entityType: "track",
      entityId: "track-1",
      lockedBy: "user-1",
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "user-1", name: "Curator User", username: "curator" },
    } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue({
      track: { ...existingTrack, title: "New Title" },
      edit: { id: "edit-1" },
    } as never);

    const body = {
      title: "New Title",
      artistId: "artist-1",
    };

    await action(makeRequest(body, { trackId: "track-1" }) as never);

    expect(prisma.editLock.delete).toHaveBeenCalledWith({ where: { id: "lock-1" } });
  });

  test("handles invalid JSON body", async () => {
    const request = {
      request: new Request("http://localhost/api/metadata/tracks/track-1/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      }),
      params: { trackId: "track-1" },
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
