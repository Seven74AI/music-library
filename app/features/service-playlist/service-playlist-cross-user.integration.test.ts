import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server";
import { createUser } from "#tests/db-utils";
import { noopArchiveEnqueueAdapter } from "./archive-enqueue-adapter.server";
import { createServicePlaylistService } from "./service-playlist.server";

const { mockGetPlaylist, mockGetPlaylistItems, mockCheckVideosExist, mockResolveToken } =
  vi.hoisted(() => ({
    mockGetPlaylist: vi.fn(),
    mockGetPlaylistItems: vi.fn(),
    mockCheckVideosExist: vi.fn(),
    mockResolveToken: vi.fn(),
  }));

vi.mock("#app/features/service-connection/service-connection.server", () => ({
  resolveServiceAccessToken: mockResolveToken,
}));

vi.mock("#app/utils/youtube.server", () => ({
  createYouTubeService: vi.fn(() => ({
    getPlaylist: mockGetPlaylist,
    getPlaylistItems: mockGetPlaylistItems,
    checkVideosExist: mockCheckVideosExist,
  })),
}));

describe("ServicePlaylist cross-user isolation", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.servicePlaylistTrack.deleteMany();
    await prisma.servicePlaylist.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.user.deleteMany();

    mockResolveToken.mockResolvedValue({ access_token: "token" });
    mockGetPlaylist.mockResolvedValue({
      id: "PLshared",
      snippet: {
        title: "Shared Playlist",
        channelId: "channel-1",
        channelTitle: "Test Channel",
        thumbnails: {},
      },
      contentDetails: { itemCount: 0 },
    });
    mockGetPlaylistItems.mockResolvedValue([]);
    mockCheckVideosExist.mockResolvedValue(new Set<string>());
  });

  test("two users can sync the same playlist without clobbering each other", async () => {
    const userA = await prisma.user.create({ data: createUser() });
    const userB = await prisma.user.create({ data: createUser() });

    const service = createServicePlaylistService({
      archiveEnqueueAdapter: noopArchiveEnqueueAdapter,
    });

    const resultA = await service.syncServicePlaylist("youtube", "PLshared", userA.id);
    const resultB = await service.syncServicePlaylist("youtube", "PLshared", userB.id);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    const playlists = await prisma.servicePlaylist.findMany({
      where: { externalId: "PLshared" },
    });

    // Each user must own their own row — no cross-user clobbering.
    expect(playlists).toHaveLength(2);
    expect(new Set(playlists.map((p) => p.ownerId))).toEqual(new Set([userA.id, userB.id]));
  });
});
