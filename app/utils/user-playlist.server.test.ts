import { describe, expect, test, vi, beforeEach } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  addTrackToUserPlaylist,
  createUserPlaylist,
  createUserPlaylistWithTrack,
  normalizeUserPlaylistTitle,
  userPlaylistTitleTaken,
} from "./user-playlist.server";

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    userPlaylist: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    userPlaylistTrack: {
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("normalizeUserPlaylistTitle", () => {
  test("trims and lowercases", () => {
    expect(normalizeUserPlaylistTitle("  Road Trip  ")).toBe("road trip");
  });
});

describe("userPlaylistTitleTaken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("detects case-insensitive duplicate", async () => {
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([
      { id: "playlist-1", title: "Road Trip" },
    ] as never);

    const result = await userPlaylistTitleTaken({
      userId: "user-1",
      title: "road trip",
    });

    expect(result).toEqual({ taken: true, existingTitle: "Road Trip" });
  });

  test("excludes playlist when renaming", async () => {
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([
      { id: "playlist-1", title: "Road Trip" },
    ] as never);

    const result = await userPlaylistTitleTaken({
      userId: "user-1",
      title: "Road Trip",
      excludePlaylistId: "playlist-1",
    });

    expect(result).toEqual({ taken: false });
  });
});

describe("createUserPlaylist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("creates playlist when title is unique", async () => {
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([]);
    vi.mocked(prisma.userPlaylist.create).mockResolvedValue({
      id: "playlist-1",
      title: "Road Trip",
      description: null,
      _count: { tracks: 0 },
    } as never);

    const result = await createUserPlaylist({
      userId: "user-1",
      title: "Road Trip",
    });

    expect(result).toEqual({
      status: "success",
      playlist: {
        id: "playlist-1",
        title: "Road Trip",
        description: null,
        _count: { tracks: 0 },
      },
    });
  });

  test("returns duplicate_title for case-insensitive match", async () => {
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([
      { id: "playlist-1", title: "Road Trip" },
    ] as never);

    const result = await createUserPlaylist({
      userId: "user-1",
      title: "road trip",
    });

    expect(result).toEqual({
      status: "duplicate_title",
      existingTitle: "Road Trip",
    });
    expect(prisma.userPlaylist.create).not.toHaveBeenCalled();
  });

  test("returns invalid_title for empty title", async () => {
    const result = await createUserPlaylist({
      userId: "user-1",
      title: "   ",
    });

    expect(result).toEqual({ status: "invalid_title" });
  });
});

describe("createUserPlaylistWithTrack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("creates playlist and adds track", async () => {
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([]);
    vi.mocked(prisma.userPlaylist.create).mockResolvedValue({
      id: "playlist-1",
      title: "Road Trip",
      description: null,
    } as never);
    vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
      id: "playlist-1",
      title: "Road Trip",
    } as never);
    vi.mocked(prisma.userPlaylistTrack.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userPlaylistTrack.aggregate).mockResolvedValue({
      _max: { position: null },
    } as never);
    vi.mocked(prisma.userPlaylistTrack.create).mockResolvedValue({} as never);

    const result = await createUserPlaylistWithTrack({
      userId: "user-1",
      title: "Road Trip",
      trackId: "track-1",
    });

    expect(result).toEqual({
      status: "success",
      playlist: {
        id: "playlist-1",
        title: "Road Trip",
        description: null,
        _count: { tracks: 1 },
      },
    });
  });
});

describe("addTrackToUserPlaylist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("adds track when playlist exists and track is not a duplicate", async () => {
    vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
      id: "playlist-1",
      title: "My Playlist",
    } as never);
    vi.mocked(prisma.userPlaylistTrack.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userPlaylistTrack.aggregate).mockResolvedValue({
      _max: { position: 2 },
    } as never);
    vi.mocked(prisma.userPlaylistTrack.create).mockResolvedValue({} as never);

    const result = await addTrackToUserPlaylist({
      userId: "user-1",
      playlistId: "playlist-1",
      trackId: "track-1",
    });

    expect(result).toEqual({
      status: "success",
      playlistTitle: "My Playlist",
    });
  });

  test("bumps playlist updatedAt when a track is added", async () => {
    vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
      id: "playlist-1",
      title: "My Playlist",
    } as never);
    vi.mocked(prisma.userPlaylistTrack.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.userPlaylistTrack.aggregate).mockResolvedValue({
      _max: { position: 2 },
    } as never);
    vi.mocked(prisma.userPlaylistTrack.create).mockResolvedValue({} as never);

    const result = await addTrackToUserPlaylist({
      userId: "user-1",
      playlistId: "playlist-1",
      trackId: "track-1",
    });

    expect(result).toEqual({ status: "success", playlistTitle: "My Playlist" });
    expect(prisma.userPlaylist.update).toHaveBeenCalledWith({
      where: { id: "playlist-1", ownerId: "user-1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  test("returns not_found when playlist does not belong to user", async () => {
    vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue(null);

    const result = await addTrackToUserPlaylist({
      userId: "user-1",
      playlistId: "playlist-1",
      trackId: "track-1",
    });

    expect(result).toEqual({ status: "not_found" });
  });

  test("returns duplicate when track already exists in playlist", async () => {
    vi.mocked(prisma.userPlaylist.findFirst).mockResolvedValue({
      id: "playlist-1",
      title: "My Playlist",
    } as never);
    vi.mocked(prisma.userPlaylistTrack.findFirst).mockResolvedValue({
      id: "existing",
    } as never);

    const result = await addTrackToUserPlaylist({
      userId: "user-1",
      playlistId: "playlist-1",
      trackId: "track-1",
    });

    expect(result).toEqual({
      status: "duplicate",
      playlistId: "playlist-1",
      playlistTitle: "My Playlist",
    });
  });
});
