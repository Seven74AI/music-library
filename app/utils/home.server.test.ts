import { beforeEach, describe, expect, test, vi } from "vitest";
import { getHeavyRotationTracks } from "#app/features/listening-insights/index.server.ts";
import { getRecentlyPlayedTracks } from "#app/features/recently-played/recently-played.server.ts";
import { hasServiceConnection } from "#app/features/service-connection/service-connection.server";
import { getWeeklyWrap } from "#app/features/weekly-wrap/weekly-wrap.server.ts";
import { getUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  loadHomeData,
  resolveHomeMode,
  accumulatePlaylistDurations,
  type HomeData,
} from "./home.server.ts";

vi.mock("#app/utils/auth.server.ts", () => ({
  getUserId: vi.fn(),
}));

vi.mock("#app/features/listening-insights/index.server.ts", () => ({
  getHeavyRotationTracks: vi.fn().mockResolvedValue([]),
}));

vi.mock("#app/utils/db.server.ts", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
    userTrack: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    userPlaylist: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    userPlaylistTrack: {
      findMany: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("#app/features/service-connection/service-connection.server", () => ({
  hasServiceConnection: vi.fn(),
}));

vi.mock("#app/features/service-playlist/service-playlist.server.ts", () => ({
  createServicePlaylistService: vi.fn(() => ({
    getSyncedPlaylists: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("#app/features/on-repeat-snapshots/queries.server.ts", () => ({
  listOnRepeatSnapshotShelf: vi.fn().mockResolvedValue([]),
}));

vi.mock("#app/features/recently-played/recently-played.server.ts", () => ({
  getRecentlyPlayedTracks: vi.fn(),
}));

vi.mock("#app/features/weekly-wrap/weekly-wrap.server.ts", () => ({
  getWeeklyWrap: vi.fn(),
}));

function unwrapHomeData(result: Awaited<ReturnType<typeof loadHomeData>>): HomeData {
  return (result as { data: HomeData }).data;
}

const mockAdminUser = {
  id: "user-1",
  email: "admin@example.com",
  username: "admin",
  name: "Admin User",
  disabledAt: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

describe("resolveHomeMode", () => {
  test("returns onboarding when there are no library tracks", () => {
    expect(resolveHomeMode(0, 0)).toBe("onboarding");
  });

  test("returns gray when there are tracks but none are playable", () => {
    expect(resolveHomeMode(5, 0)).toBe("gray");
  });

  test("returns listening when there is at least one playable track", () => {
    expect(resolveHomeMode(5, 2)).toBe("listening");
  });
});

describe("accumulatePlaylistDurations", () => {
  test("sums durations per playlist and treats null as zero", () => {
    const totals = accumulatePlaylistDurations([
      { playlistId: "p1", track: { duration: 100 } },
      { playlistId: "p1", track: { duration: 50 } },
      { playlistId: "p1", track: { duration: null } },
      { playlistId: "p2", track: { duration: 200 } },
    ]);

    expect(totals.get("p1")).toBe(150);
    expect(totals.get("p2")).toBe(200);
  });
});

describe("loadHomeData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValue([]);
    vi.mocked(getRecentlyPlayedTracks).mockResolvedValue([]);
    vi.mocked(getWeeklyWrap).mockResolvedValue(null);
  });

  test("returns marketing mode for anonymous users", async () => {
    vi.mocked(getUserId).mockResolvedValue(null);

    const result = unwrapHomeData(await loadHomeData(new Request("http://localhost/")));

    expect(result).toEqual({ mode: "marketing" });
  });

  test("returns onboarding mode with YouTube status when library is empty", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.userTrack.count).mockResolvedValue(0);
    vi.mocked(hasServiceConnection).mockResolvedValue(true);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(mockAdminUser);

    const result = unwrapHomeData(await loadHomeData(new Request("http://localhost/")));

    expect(result).toEqual({
      mode: "onboarding",
      youtubeConnected: true,
      isAdmin: true,
    });
  });

  test("returns isAdmin false for non-admin users in onboarding mode", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.userTrack.count).mockResolvedValue(0);
    vi.mocked(hasServiceConnection).mockResolvedValue(false);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

    const result = unwrapHomeData(await loadHomeData(new Request("http://localhost/")));

    expect(result).toEqual({
      mode: "onboarding",
      youtubeConnected: false,
      isAdmin: false,
    });
  });

  test("returns gray mode with track counts when nothing is playable yet", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.userTrack.count).mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    vi.mocked(prisma.userPlaylist.count).mockResolvedValue(1);
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([]);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(null);

    const result = unwrapHomeData(await loadHomeData(new Request("http://localhost/")));

    expect(result).toMatchObject({
      mode: "gray",
      totalTracks: 3,
      playableTracks: 0,
      archivingCount: 3,
      stats: { totalTracks: 3, totalPlaylists: 1 },
    });
  });

  test("returns listening mode when playable tracks exist", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.userTrack.count).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    vi.mocked(prisma.userPlaylist.count).mockResolvedValue(2);
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([]);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(null);
    vi.mocked(getWeeklyWrap).mockResolvedValue({
      finishes: 5,
      uniqueTracks: 3,
      dayStreak: 2,
    });

    const result = unwrapHomeData(await loadHomeData(new Request("http://localhost/")));

    expect(result).toMatchObject({
      mode: "listening",
      totalTracks: 4,
      playableTracks: 2,
      archivingCount: 2,
      recentlyPlayed: [],
      heavyRotationMonth: [],
      heavyRotationEver: [],
      onRepeatSnapshots: [],
      weeklyWrap: { finishes: 5, uniqueTracks: 3, dayStreak: 2 },
    });
    expect(getRecentlyPlayedTracks).toHaveBeenCalledWith({ userId: "user-1" });
    expect(getHeavyRotationTracks).toHaveBeenCalledWith({ userId: "user-1", window: "month" });
    expect(getHeavyRotationTracks).toHaveBeenCalledWith({ userId: "user-1", window: "ever" });
    expect(getWeeklyWrap).toHaveBeenCalledWith("user-1");
  });

  test("includes recentlyPlayed tracks from play_completed query", async () => {
    const recentlyPlayed = [
      {
        playedAt: new Date("2026-09-23T12:00:00.000Z"),
        track: {
          id: "track-1",
          title: "Finished Song",
          duration: 180,
          serviceUrl: null,
          artist: { id: "a1", name: "Artist" },
          coverImage: null,
          service: null,
          audioFiles: [],
        },
      },
    ];
    vi.mocked(getUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.userTrack.count).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    vi.mocked(prisma.userPlaylist.count).mockResolvedValue(0);
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([]);
    vi.mocked(getRecentlyPlayedTracks).mockResolvedValue(recentlyPlayed);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(null);

    const result = unwrapHomeData(await loadHomeData(new Request("http://localhost/")));

    expect(result).toMatchObject({
      mode: "listening",
      recentlyPlayed,
    });
    expect(getRecentlyPlayedTracks).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("attaches full playlist duration while keeping cover preview tracks", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-1");
    vi.mocked(prisma.userTrack.count).mockResolvedValueOnce(4).mockResolvedValueOnce(2);
    vi.mocked(prisma.userPlaylist.count).mockResolvedValue(1);
    vi.mocked(prisma.userTrack.findMany).mockResolvedValue([]);
    vi.mocked(prisma.userPlaylist.findMany).mockResolvedValue([
      {
        id: "playlist-1",
        title: "Chill Vibes",
        description: null,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-06-01"),
        _count: { tracks: 3 },
        tracks: [
          {
            id: "pt-1",
            track: {
              id: "track-1",
              title: "One",
              artist: { id: "a1", name: "Artist" },
              duration: 100,
              coverImage: null,
            },
          },
        ],
      },
    ] as never);
    vi.mocked(prisma.userPlaylistTrack.findMany).mockResolvedValue([
      { playlistId: "playlist-1", track: { duration: 100 } },
      { playlistId: "playlist-1", track: { duration: 200 } },
      { playlistId: "playlist-1", track: { duration: 300 } },
    ] as never);
    vi.mocked(prisma.service.findUnique).mockResolvedValue(null);

    const result = unwrapHomeData(await loadHomeData(new Request("http://localhost/")));

    expect(result).toMatchObject({
      mode: "listening",
      recentPlaylists: [
        {
          id: "playlist-1",
          trackCount: 3,
          totalDuration: 600,
          tracks: [{ id: "pt-1" }],
        },
      ],
    });
    expect(prisma.userPlaylistTrack.findMany).toHaveBeenCalledWith({
      where: { playlistId: { in: ["playlist-1"] } },
      select: {
        playlistId: true,
        track: { select: { duration: true } },
      },
    });
  });
});
